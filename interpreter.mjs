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

import { instructions, instructions_raw } from "./instructions.mjs";
import { Queue } from "./queue.mjs";
import { Jit } from "./jit.mjs";

import { overlay as WS_overlay } from "./overlays/WS.mjs";
import { overlay as S_overlay } from "./overlays/S.mjs";


function gen_fingerprint(s) {
  let x = 0;
  for(let c of Array.from(s).map(x => x.charCodeAt(0))) {
    x = x * 256 + c;
  }
  return x;
}
var overlays = {};
overlays[gen_fingerprint("WS")] = WS_overlay;
overlays[gen_fingerprint("S")] = S_overlay;


function deep_copy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function shallow_copy(obj) {
  return Object.fromEntries(Object.entries(obj));
}

function shallowish_copy(obj, i) {
  if (i > 0) {
    return shallowish_copy(obj, i - 1);
  } else {
    return shallow_copy(obj);
  }
}

class Thread {
  running = true;
  mode = "normal";
  jit = null;
  tick_count = 0;

  constructor(interpreter, col, row, cold, rowd, stack, overlays) {
    this.interpreter = interpreter;
    this.col = col;
    this.row = row;
    this.cold = cold;
    this.rowd = rowd;
    this.stack = stack;
    this.overlays = overlays || {};
  }

  split_thread(old_thread) {
    let thread = new Thread(
      this.col - this.cold,
      this.row - this.rowd,
      -this.cold,
      -this.rowd,
      deep_copy(this.stack),
      deep_copy(this.overlays),
    );
    thread.tick_count = old_thread.tick_count; // Ensure new thread has equal priority to old thread.
    return thread;
  }

  pop() {
    if (this.stack.length > 0) {
      return this.stack.pop();
    } else {
      this.interpreter.error(this, "Stack underflow");
      return 0;
    }
  }
}

export class Interpreter {
  max_loops = 1000;
  paused_wake = null;
  paused_event = null;
  slice_loops = 1;
  slice_sleep = 20;
  running = false;
  threads = [];
  events = {};
  awake_sleep = null;
  stats = [];
  field = [];
  instructions = shallow_copy(instructions);
  instructions_raw = shallow_copy(instructions_raw);
  overlays = shallowish_copy(overlays, 1);
  input_queue = new Queue(); // Queue things like: change speed, input, etc.
  stdin_queue = new Queue(); // Chars from stdin.
  stdin_waiters = [];

  constructor() {
    this.jit = new Jit(this);
  }

  trigger_event(event_name, ...args) {
    console.log(`Event: ${event_name} -- ${args}`);
  }

  set_speed(raw_speed) {
    if (raw_speed > 0) {
      this.slice_sleep = 1;
      this.slice_loops = Math.floor(1.1 ** raw_speed);
    } else {
      this.slice_sleep = Math.floor(1.1 ** -raw_speed);
      this.slice_loops = 1;
    }
  }

  toggle_pause(e) {
    if (this.paused_wake === null) {
      this.pause();
    } else {
      this.unpause();
    }
  }
  pause() {
    let thisthis = this;
    this.paused_event = new Promise(function (r) {
      thisthis.paused_wake = r;
      // We shouldn't be in the sleep loop if paused.
      if (thisthis.awake_sleep != null) thisthis.awake_sleep();
    });
    // These really need outputting from the main loop, not here!
    this.trigger_event("paused", true);
    this.threads.forEach(function (thread) {
      thisthis.trigger_event("thread_paused", thread, true);
    });
  }
  unpause() {
    let old_wake = this.paused_wake;
    let thisthis = this;
    this.paused_wake = null;
    this.trigger_event("paused", false);
    this.threads.forEach(function (thread) {
      thisthis.trigger_event("thread_paused", thread, false)
    });
    if (old_wake)
      old_wake();
  }

  async sleep_until_unpaused() { // TODO???
    if (!this.paused_event)
      await this.sleep(this.slice_sleep);
    if (this.paused_event) {
      let paused_event = this.paused_event;
      this.paused_event = null;
      let unpause_data = await paused_event;
      return unpause_data;
    }
  }

  step(e) { // TODO ???
    let old_wake = this.paused_wake;
    pause();
    if (old_wake !== null) {
      old_wake({count: 1});
    }
  }
  step_thread(thread) { // ???
    let old_wake = this.paused_wake;
    pause();
    if (old_wake !== null) {
      old_wake({threads: [thread], count: 1});
    }
  }

  async go() {
    console.log(this.threads);
    this.stop();
    if (this.running_promise != null) {
      console.log("Waiting for last thread to exit");
      await this.running_promise;
      console.log("Last thread has exited");
    }
    if (this.threads.length > 0) {
      this.trigger_event("started");
    }
    let thread = new Thread(this, 0, 0, 1, 0, []);
    this.threads.push(thread);
    this.main_loop();
  }

  stop() {
    if (this.threads.length > 0) {
      this.trigger_event("stopped");
    }
    this.threads.forEach(function (thread) { thread.running = false; });
    this.unpause();
    if (this.awake_sleep != null) this.awake_sleep();
  }

  check(state, row, col) {
    if (row < 0 || row >= height) error(state, `Row ${row} is out of bounds`);
    else if (col < 0 || col >= height) error(state, `Col ${col} is out of bounds`);
    else return true;
  }
  set_field(state, col, row, val) {
    if (this.check(state, col, row)) {
      set_cell(document.getElementById("table").children[row].children[col], col, row, val);
    } else {
      console.log(`out of bounds access ${state} ${col} ${row} ${val}`);
    }
  }
  set_cell(cell, col, row, val) {
    let val_str = String.fromCharCode(val);
    this.field[row][col] = val;
    document.getElementById("table").children[row].children[col].innerText = val_str == " " ? "\u00a0" : val_str;
    let title = `(${col},${row})=${val} (${val_str})`;
    if (this.instructions_raw[val_str] !== undefined)
      title += ": " + this.instructions_raw[val_str].desc;
    document.getElementById("table").children[row].children[col].title = title;
    this.jit.cell_changed(row, col);
  }
  get_field(state, col, row, val) {
    if (check(state, col, row)) {
      return this.field[row][col];
    }
  }
  out(s) {
    this.trigger_event("char_out", s);
    console.log("Out: " + s);
  }
  oute(s) {
    this.trigger_event("error_ocurred", s);
    console.log("Err: " + s);
  }


  outnl() {
    console.log("Outnl");
  }
  error(thread, message) {
    thread.running = false;
    this.output_error(thread, message);
  }
  output_error(thread, message) {
    this.oute(`ERROR: ${message}`);
    this.oute(`State was: ${thread}`);
  }

  async sleep(ms) {
    await new Promise(r => { this.awake_sleep = r; setTimeout(r, ms) });
    this.awake_sleep = null;
  }
  async main_loop() {
    let ticks = 0;
    this.running = true;
    let running_wake = null;
    this.running_promise = new Promise(r => { running_wake = r; });
    let highlighted_cells = [];
    let start_time = new Date().getTime();
    while(this.threads.length > 0) {
      while (this.input_queue.length > 0) {
        let item = this.input_queue.pop();
        if (item[0] == "set_speed") {
          this.set_speed(item[1]);
        } else if (item[0] == "pause") {
          this.pause();
        } else if (item[0] == "unpause") {
          this.unpause();
        } else if (item[0] == "stdin") {
          if (this.stdin_waiters.length > 0) {
            this.stdin_waiters.shift()(item[1]);
          } else {
            this.stdin_queue.push(item[1]);
          }
        }
      }
      let slice_loops = this.slice_loops;
      let limit_threads = null;
      let need_sleep = true;

      this.threads.forEach(thread => this.trigger_event("thread_state_updated", thread));
      this.trigger_event("thread_state_synced");

      if (ticks > this.max_loops) {
        let end_time = new Date().getTime();
        this.oute(`Ran out of ticks! (${ticks} > ${document.getElementById("max_loops").value})`);
        console.log(`${ticks} in ${end_time - start_time} is ${ticks / (end_time - start_time) / 1000} MHz`);
        pause();
      }

      let unpause_data = await this.sleep_until_unpaused();
      if (unpause_data) {
        console.log(`Unpaused; resetting ticks to 0 from ${ticks}`);
        ticks = 0;
        start_time = new Date().getTime();
        if (unpause_data.count !== undefined) {
          need_sleep = false;
          slice_loops = unpause_data.count;
        }
        if (unpause_data.threads !== undefined)
          limit_threads = unpause_data.threads;
      }

      let count = 0;
      let dead_threads = [];
      while(count < slice_loops && this.threads.length > 0) {
        // This will _not_ iterate over newly-added threads.
        let to_iter = limit_threads !== null ? limit_threads : this.threads;
        to_iter = to_iter.filter(thread => !thread.blocked);
        if (to_iter.length == 0) break;
        let min_count = Math.min(...to_iter.map(x => x.tick_count));
        to_iter.forEach((thread, i) => {
          if (thread.tick_count == min_count) {
            let tick_count = this.tick(thread, slice_loops - count, i);
            count += tick_count;
            thread.tick_count += tick_count;
          }
        });
        let new_dead_threads = this.threads.filter(t => !t.running);
        if (new_dead_threads) {
          dead_threads.push(...new_dead_threads);
          this.threads = this.threads.filter(t => t.running);
        }
      }

      dead_threads.forEach(
        dead_thread => this.trigger_event("thread_dead", dead_thread));

      ticks += count;
    }
    this.trigger_event("terminate");
    running_wake();
    console.log(`exited main_loop with ticks ${ticks}`);
  }
  tick(thread, target_ticks, thread_num) {
    if (thread.waiter) {
      if (thread.waiter(thread)) {
        thread.waiter = null;
      }
      return 1;
    }
    if (thread.mode == "normal") {
      let jit_return = this.jit.step_jit(thread, target_ticks);
      if (jit_return > 0) {
        return jit_return;
      }
      let symbol = this.field[thread.row][thread.col];
      let instruction = thread.overlays[symbol] || this.instructions[symbol];
      console.log("Executing " + String.fromCharCode(symbol));
      if (instruction == null) {
        this.error(thread, "Invalid instruction: " + symbol);
      } else {
        try {
          let ret = instruction(thread, thread_num);
          if (ret && ret.constructor === Promise) {
            thread.blocked = true;
          }
        } catch (err) {
          this.error(thread, "Exception caught during " + symbol + ": " + err.message);
          console.log(err.stack);
        }
      }
    } else if (thread.mode == "string") {
      if (symbol == '"'.charCodeAt(0)) {
        thread.mode = "normal";
      } else {
        thread.stack.push(symbol);
      }
    }
    thread.tick_count += 1;
    thread.col += thread.cold;
    thread.row += thread.rowd;
    if (thread.row == this.field.length) thread.row = 0;
    else if (thread.row == -1) thread.row = this.field.length - 1;
    if (thread.col == this.field[thread.row].length) thread.col = 0;
    else if (thread.col == -1) thread.col = this.field[thread.row].length - 1;
    return 1;
  }
}
