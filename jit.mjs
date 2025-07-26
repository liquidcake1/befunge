// JIT TODO:
// * OK, it's probably about 6x faster with JIT than without, but we can go another 4-5x faster by loop unrolling.
// * We don't bounds-check the stack before executing a JITted routine.
// * We can probably do a lot better in speed by unrolling and aliasing the stack. Name top N stack vars a1 to aN,
//   then unpack the top N into those, then run code, then pack aN to a?.
// * We don't have support for branches, even just the dumb "primary only, bail otherwise" variety.
// * We don't ever remove JIT. We should destroy JIT when a cell is modified.
// * If a cell is modified _DURING_ a JITted sequence, what do? If external, we can just claim it doesn't matter.
//   If the thread self-modified, we'll need a means to abort the JITted sequence early.
// * There is no JIT visualisation.

function diagonalise_positive(row, col) {
  /*
      0 1 3 6
      2 4 7
      5 8
      9
      */
  let shell = row + col;
  let prev_shell_indices = shell * (shell + 1) / 2;
  return prev_shell_indices + row;
}

function dediagonalise_positive(diagonal_index) {
  // n (n + 1) / 2 = x;
  let shell = Math.floor((Math.sqrt(8 * diagonal_index + 1) - 1) / 2);
  let row_0_index = diagonalise_positive(0, shell);
  let row = diagonal_index - row_0_index;
  let col = shell - row;
  return [row, col];
}

function diagonalise_any(row, col) {
   /*
      35 21 11 23 39
      20 10  4 12 24
       9  3  0  1  5
      18  8  2  6 14
      31 17  7 15 27
      */
  let shell = Math.abs(row) + Math.abs(col);
  if (shell == 0) return 0;
  let prev_shell_indices = 2 * shell * (shell - 1);
  if (row >= 0) {
    return prev_shell_indices + shell + 1 - col;
  } else {
    return prev_shell_indices + 3 * shell + 1 + col;
  }
}

function dediagonalise_any(diagonal_index) {
  if (diagonal_index == 0) {
    return [0, 0];
  }
  // cumulative past shell size is (shell-1)^2 + shell^2
  // so 2s^2 - 2s + 1 = n
  // (2 + (4-8(1-n))^0.5)/4 = ((2n-1)^0.5+1)/2
  let shell = Math.floor((Math.sqrt(2*diagonal_index-1)+1)/2);
  let row_0_pos_index = diagonalise_any(0, shell);
  let col = shell - diagonal_index + row_0_pos_index;
  if (col < -shell) {
    col = -2 * shell - col;
  }
  let row = diagonal_index - row_0_pos_index;
  if (row > shell) {
    row = 2 * shell - row;
  }
  if (row < -shell) {
    row = -2 * shell - row;
  }
  return [row, col];
}

function diagonalise_with_dir(row, col, rowd, cold) {
  return 4 * diagonalise_positive(row, col) + diagonalise_any(rowd, cold);
}

function dediagonalise_with_dir(diagonal_index) {
  let dir_diag = diagonal_index % 4;
  let pos_diag = diagonal_index / 4;
  return dediagonalise_any(pos_diag).concat(dediagonalise_positive(dir_diag));
}

class CellStats {
  hit_count = 1;
  jit_starts = [];
  jit = null;
}

class JitPath {
  path = [];
  code = "";
  stack_req = 0;
  stack_delta = 0;
  instruction_count = 0;
  constructor() {
  }
}

class JitFragment {
  end_row = null;
  end_col = null;
  end_rowd = null;
  end_cold = null;
  instruction_count = null;
  path = null;
  stack_req = null;
  code = null;
  jit_starts = []; // Should just be the initial cell, but kept for consistency

  constructor(thread, instruction_count, path, stack_req, code) {
    // TODO: let [end_row, end_col, end_rowd, end_cold] = dediagonalise_with_dir(resting_place);
    this.end_row = thread.row;
    this.end_col = thread.col;
    this.end_rowd = thread.rowd;
    this.end_cold = thread.cold;
    this.instruction_count = instruction_count;
    this.path = path;
    this.stack_req = stack_req;
    this.code = code;
  }

  maybe_run_in_thread(thread, target_ticks) {
    // TODO include this fragment in the JIT code itself.
    // TODO should store and check thread fingerprints!
    if (this.instruction_count > target_ticks || thread.stack.length < this.stack_req) {
      // Checking requirements not met. Just interpret.
      //console.log(`Not running JIT. ${this.instruction_count} > ${target_ticks} || ${thread.stack.length} < ${this.stack_req}`);
      return 0;
    }
    try {
      this.call(thread);
    } catch (err) {
      thread.interpreter.error(thread, `Exception caught in JIT: ${err.message}`);
      // TODO: Stop thread?!
    }
    thread.tick_count += this.instruction_count;
    thread.row = this.end_row;
    thread.col = this.end_col;
    thread.rowd = this.end_rowd;
    thread.cold = this.end_cold;
    return this.instruction_count;
  }
}

export class Jit {
  cell_stats = {};
  path = null;
  threshold = 10000000000;
  interpreter = null;

  constructor(interpreter) {
    this.interpreter = interpreter;
  }

  step_jit(thread, target_ticks) {
    let diagonal_index = diagonalise_with_dir(thread.row, thread.col, thread.rowd, thread.cold);
    let jit_path = thread.jit_path;
    if (jit_path === undefined) {
      let cell_stats = this.cell_stats[diagonal_index];
      // Run jitted code, if present, else increment count and possibly start a JIT follow.
      if (!cell_stats) {
        this.cell_stats[diagonal_index] = new CellStats();
        return 0;
      } else if (cell_stats.jit) {
        return cell_stats.jit.maybe_run_in_thread(thread, target_ticks);
      } else {
        cell_stats.hit_count += 1;
        if (cell_stats.hit_count < this.threshold) {
          return 0;
        }
        //console.log(`loop found at ${diagonal_index}?`);
        thread.jit_path = jit_path = new JitPath();
        // Fall through to below now.
      }
    }
    //console.log(`${jit_path}`);
    if (jit_path.path.length > 0 && diagonal_index == jit_path.path[0]) {
      // We completed a path.
      let jit = this.complete_jit(thread);
      // Run it, else we'll run the current instruction and then begin a new
      // loop at the next cell, which will prevent evaluation of this one!
      return jit.maybe_run_in_thread(thread, target_ticks);
    }
    // We're following a path.
    // TODO this should not need to do string futzing.
    let symbol = this.interpreter.field[thread.row][thread.col];
    if (thread.overlays[symbol] !== undefined) {
      // TODO
      //console.log("Stopping JIT as we're entering an instruction from an overlay.");
      this.complete_jit(thread);
      return 0;
    }
    let raw_instruction = this.interpreter.instructions_raw[String.fromCharCode(symbol)];
    if (raw_instruction === undefined) {
      //console.log("Stopping JIT as we're entering an unknown instruction.");
      this.complete_jit(thread);
      return 0;
    }
    if (!raw_instruction.can_jit) {
      //console.log("Stopping JIT as we're entering an instruction I don't understand.");
      //console.log(jit_path);
      this.complete_jit(thread);
      return 0;
    }
    jit_path.code += `// ${String.fromCharCode(symbol)} at row ${thread.row}, col ${thread.col}, heading ${thread.rowd}, ${thread.cold}\n`;
    let real_code = raw_instruction.unchecked_js_code;
    if (typeof real_code == 'function') {
      real_code = real_code(thread);
    }
    jit_path.code += `${real_code}\n`;
    jit_path.stack_req = Math.max(jit_path.stack_req, -jit_path.stack_delta - raw_instruction.stack_min);
    jit_path.stack_delta += raw_instruction.stack_return - raw_instruction.stack_min;
    jit_path.path.push(diagonal_index);
    jit_path.instruction_count += 1;
    //console.log(jit_path);
    return 0;
  }

  complete_jit(thread) {
    let jit_path = thread.jit_path;
    thread.jit_path = undefined;
    if (jit_path.path.length == 0) {
      //console.log("JIT path is empty.");
      return;
    }
    console.log("Performing JIT compile, length " + jit_path.path.length);
    //console.log(jit_path);
    // TODO: jit_path.compile()
    let code = `jit.call=function (thread) {\nlet stack = thread.stack;\n${jit_path.code}\n}`;
    //console.log(code);
    let jit = new JitFragment(thread, jit_path.instruction_count, jit_path.path, jit_path.stack_req, code);
    //console.log(jit);
    eval(code);
    //console.log(jit);
    let starting_place = jit_path.path[0];
    this.cell_stats[jit_path.path[0]].jit = jit;
    for(let i=0; i<jit_path.path.length; i++) {
      this.cell_stats[jit_path.path[i]].jit_starts.push(starting_place);
    }
    // Drop out of follow mode, now.
    return jit;
  }

  cell_changed(row, col) {
    let dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for(let i=0; i<4; i++) {
      let rowd = dirs[i][0];
      let cold = dirs[i][1];
      let cell_diagonal_index = diagonalise_with_dir(row, col, rowd, cold);
      let cell_stats = this.cell_stats[cell_diagonal_index];
      if (cell_stats) {
        console.log(`clearing jit at ${row} ${col} ${rowd} ${cold}`);
        for(let j=0; j<cell_stats.jit_starts.length; j++) {
          console.log(`clearing jit at ${cell_stats.jit_starts[j]}`);
          this.cell_stats[cell_stats.jit_starts[j]] = undefined;
        }
      }
    }
  }
}
