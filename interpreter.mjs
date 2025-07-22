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

function gen_fingerprint(s) {
  let x = 0;
  for(let c of Array.from(s).map(x => x.charCodeAt(0))) {
    x = x * 256 + c;
  }
  return x;
}

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

  split_thread() {
    let thread = new Thread(
      this.interpreter,
      this.col,
      this.row,
      -this.cold,
      -this.rowd,
      deep_copy(this.stack),
      deep_copy(this.overlays),
    );
    thread.tick_forwards();
    thread.tick_count = this.tick_count; // Ensure new thread has equal priority to old thread.
    return thread;
  }

  tick_forwards() {
    this.col += this.cold;
    this.row += this.rowd;
    if (this.row == this.interpreter.field.length && this.rowd > 0) this.row = 0;
    else if (this.row == -1 && this.rowd < 0) this.row = this.interpreter.field.length - 1;
    if (this.col == this.interpreter.field[this.row].length && this.cold > 0) this.col = 0;
    else if (this.col == -1 && this.cold < 0) this.col = this.interpreter.field[this.row].length - 1;
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
  overlays = {};
  input_queue = new Queue(); // Queue things like: change speed, input, etc.
  stdin_queue = new Queue(); // Chars from stdin.
  stdin_waiters = [];
  handlers = {};

  constructor() {
    this.jit = new Jit(this);
  }

  load_overlay(fingerprint, overlay) {
    this.overlays[gen_fingerprint(fingerprint)] = overlay;
  }

  add_handler(event_name, f) {
    if (this.handlers[event_name] === undefined) {
      this.handlers[event_name] = [];
    }
    this.handlers[event_name].push(f);
  }

  trigger_event(event_name, ...args) {
    //console.log(`Event: ${event_name} -- ${args}`);
    let handlers = this.handlers[event_name];
    if (handlers === undefined) {
      //console.log(`Unhandled event: ${event_name} -- ${args}`);
    } else {
      handlers.forEach(f => f(...args));
    }
  }

  set_speed(raw_speed) {
    if (raw_speed > 0) {
      this.slice_sleep = 1;
      this.slice_loops = Math.floor(1.1 ** raw_speed);
    } else {
      this.slice_sleep = Math.floor(1.1 ** -raw_speed);
      this.slice_loops = 1;
    }
    this.trigger_event("speed_changed", raw_speed, this.slice_sleep, this.slice_loops);
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

  async sleep_until_unpaused(all_blocked) { // TODO???
    if (!this.paused_event)
      await this.sleep(all_blocked ? 50 : this.slice_sleep);
    if (this.paused_event) {
      let paused_event = this.paused_event;
      this.paused_event = null;
      let unpause_data = await paused_event;
      return unpause_data;
    }
  }

  step(e) {
    let old_wake = this.paused_wake;
    this.pause();
    if (old_wake !== null) {
      old_wake({count: 1});
    }
  }

  step_thread(thread) {
    let old_wake = this.paused_wake;
    this.pause();
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
    let thread = new Thread(this, 0, 0, 1, 0, []);
    this.new_thread(thread);
    this.trigger_event("started");
    this.main_loop();
  }

  new_thread(thread) {
    this.threads.push(thread);
    this.trigger_event("thread_created", thread);
  }

  stop() {
    if (this.threads.length > 0) {
      this.trigger_event("stopped");
    }
    this.threads.forEach(function (thread) { thread.running = false; });
    this.unpause();
    if (this.awake_sleep != null) this.awake_sleep();
  }

  check(state, col, row) {
    if (row < 0 || row >= this.field.length) this.error(state, `Row ${row} is out of bounds`);
    //else if (col < 0 || col >= this.field[row].length) this.error(state, `Col ${col} is out of bounds`);
    else return true;
  }

  set_field(state, col, row, val) {
    if (this.check(state, col, row)) {
      this.set_cell(col, row, val);
    } else {
      console.log(`out of bounds access ${state} ${col} ${row} ${val}`);
    }
  }

  set_cell(col, row, val) {
    let val_str = String.fromCharCode(val);
    this.field[row][col] = val;
    let title = `(${col},${row})=${val} (${val_str})`;
    if (this.instructions_raw[val_str] !== undefined)
      title += ": " + this.instructions_raw[val_str].desc;
    this.jit.cell_changed(row, col);
    this.trigger_event("cell_changed", col, row, val);
  }

  get_field(state, col, row, val) {
    if (this.check(state, col, row)) {
      let val = this.field[row][col];
      return val === undefined ? 0 : val;
    }
  }

  out(s) {
    this.trigger_event("char_out", s);
    //console.log("Out: " + s);
  }
  oute(s) {
    this.trigger_event("error_occurred", s);
    console.log("Err: " + s);
  }

  error(thread, message) {
    thread.running = false;
    this.output_error(thread, message);
  }

  output_error(thread, message) {
    this.oute(`ERROR: ${message}`);
    this.oute(`State was: row=${thread.row} col=${thread.col} stack=${thread.stack}`);
    this.output_field();
  }
  
  output_field() {
    let lines = [];
    for(let row=0; row<this.field.length; row++) {
      let s = "";
      for(let col=0; col<this.field[row].length; col++) {
        let c = this.field[row][col];
        s += (c > 31 && c < 127 ? String.fromCharCode(this.field[row][col]) : "?");
      }
      lines.push(s);
    }
    this.trigger_event("output_field", lines);
  }

  async sleep(ms) {
    await new Promise(r => { this.awake_sleep = r; setTimeout(r, ms) });
    this.awake_sleep = null;
  }

  process_events() {
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
  }

  async main_loop() {
    let ticks = 0;
    this.running = true;
    let running_wake = null;
    this.running_promise = new Promise(r => { running_wake = r; });
    let highlighted_cells = [];
    let start_time = new Date().getTime();
    let all_blocked = false;
    while(this.threads.length > 0) {
      this.process_events();
      let slice_loops = this.slice_loops;
      let limit_threads = null;
      let need_sleep = true;

      this.threads.forEach(thread => this.trigger_event("thread_state_updated", thread));
      this.trigger_event("thread_state_synced", this.threads);

      if (ticks > this.max_loops) {
        let end_time = new Date().getTime();
        this.oute(`Ran out of ticks! (${ticks} > ${this.max_loops})`);
        console.log(`${ticks} in ${end_time - start_time} is ${ticks / (end_time - start_time) / 1000} MHz`);
        this.pause();
        this.output_field();
      }

      let unpause_data = await this.sleep_until_unpaused(all_blocked);
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
        all_blocked = true;
        let to_iter = limit_threads !== null ? limit_threads : this.threads;
        to_iter = to_iter.filter(thread => !thread.blocked);
        if (to_iter.length == 0) {
          break;
        }
        to_iter.forEach(function (thread) { if (!thread.waiter) { all_blocked = false; } });
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
    running_wake();
    console.log(`exited main_loop with ticks ${ticks}`);
    let end_time = new Date().getTime();
    console.log(`${ticks} in ${end_time - start_time} is ${ticks / (end_time - start_time) / 1000} MHz`);
    this.output_field();
    this.trigger_event("terminate");
  }

  tick(thread, target_ticks, thread_num) {
    if (thread.waiter) {
      try {
        if (thread.waiter(thread)) {
          thread.waiter = null;
        }
      } catch (err) {
        this.error(thread, "Exception caught during waiter: " + err.message);
        console.log(err.stack);
      }
      return 1;
    }
    if (thread.mode == "normal") {
      let symbol = this.field[thread.row][thread.col] || 32;
      let instruction = thread.overlays[symbol] || this.instructions[symbol];
      //console.log(`Executing ${String.fromCharCode(symbol)} at ${thread.col},${thread.row} stack_length=${thread.stack.length} stack_tail=${thread.stack.slice(-10)}`);
      //console.log("Executing " + String.fromCharCode(symbol));
      let jit_return = this.jit.step_jit(thread, target_ticks);
      if (jit_return > 0) {
        return jit_return;
      }
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
      let symbol = this.field[thread.row][thread.col];
      if (symbol == '"'.charCodeAt(0)) {
        thread.mode = "normal";
      } else {
        thread.stack.push(symbol);
      }
    }
    thread.tick_count += 1;
    thread.tick_forwards();
    return 1;
  }
}
