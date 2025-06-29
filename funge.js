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

let file_name = process.argv[2];
let field_s = require("fs").readFileSync(file_name, "utf8");
console.log(field_s);

let field = field_s.split("\n");
field.pop();
field = field.map( x => x.split("").map( c => c.charCodeAt(0) ) );
console.log(field);

let instructions_raw = {
  "+": {
    impl: function (thread, thread_num) { instance.exports.plus(thread_num); },
    //impl: function (thread) { thread.stack.push(-thread.pop() + thread.pop()); },
    desc: "b a → b + a",
    can_jit: true,
    stack_min: 2,
    stack_return: 1,
    unchecked_js_code: "stack[stack.length - 2] += stack.pop();",
  },
  "-": {
    impl: function (thread) { thread.stack.push(-thread.pop() + thread.pop()); },
    desc: "b a → b - a",
    can_jit: true,
    stack_min: 2,
    stack_return: 1,
    unchecked_js_code: "stack[stack.length - 2] -= stack.pop();",
  },
  "*": {
    impl: function (thread) { thread.stack.push(thread.pop() * thread.pop()); },
    desc: "b a → b * a",
    can_jit: true,
    stack_min: 2,
    stack_return: 1,
    unchecked_js_code: "stack[stack.length - 2] *= stack.pop();",
  },
  "/": {
    impl: function (thread) { let a = thread.pop(); let b = thread.pop(); thread.stack.push(Math.floor(b / a)); },
    desc: "b a → b // a",
    can_jit: true,
    stack_min: 2,
    stack_return: 1,
    unchecked_js_code: "stack[stack.length - 2] /= stack.pop();",
  },
  "%": {
    impl: function (thread) { let a = thread.pop(); let b = thread.pop(); thread.stack.push(b % a); },
    desc: "b a → b % a",
    can_jit: true,
    stack_min: 2,
    stack_return: 1,
    unchecked_js_code: "stack[stack.length - 2] %= stack.pop();",
  },
  "!": {
    impl: function (thread) { thread.stack.push(thread.pop() == 0 ? 1 : 0); },
    desc: "a → a == 0 ? 1 : 0",
    can_jit: true,
    stack_min: 1,
    stack_return: 1,
    unchecked_js_code: "stack[stack.length - 1] = stack[stack.length - 1] ? 1 : 0;",
  },
  "`": {
    impl: function (thread) { thread.stack.push(thread.pop() < thread.pop() ? 1 : 0); },
    desc: "b a → b > a ? 1 : 0",
    can_jit: true,
    stack_min: 2,
    stack_return: 1,
    unchecked_js_code: "stack[stack.length - 2] = stack.pop() < stack[stack.length - 1] ? 0 : 1;",
  },
  "<": {
    impl: function (thread) { thread.cold = -1; thread.rowd =  0; },
    desc: "() → (); go left",
    stack_min: 0,
    stack_return: 0,
    unchecked_js_code: "",
    can_jit: true,
  },
  ">": {
    impl: function (thread) { thread.cold =  1; thread.rowd =  0; },
    desc: "() → (); go right",
    stack_min: 0,
    stack_return: 0,
    unchecked_js_code: "",
    can_jit: true,
  },
  "^": {
    impl: function (thread) { thread.cold =  0; thread.rowd = -1; },
    desc: "() → (); go up",
    stack_min: 0,
    stack_return: 0,
    unchecked_js_code: "",
    can_jit: true,
  },
  "v": {
    impl: function (thread) { thread.cold =  0; thread.rowd =  1; },
    desc: "() → (); go down",
    stack_min: 0,
    stack_return: 0,
    unchecked_js_code: "",
    can_jit: true,
  },
  "?": {
    impl: function (thread) { let x = Math.floor(Math.random() * 4); thread.cold = ((x % 2) * 2 - 1) * Math.floor(x / 2); thread.rowd = ((x % 2) * 2 - 1) * ( 1 - Math.floor(x / 2)); },
    desc: "() → (); go random cardinal",
    can_jit: false,
  },
  "_": {
    impl: function (thread) { thread.rowd =  0; thread.cold = thread.pop() == 0 ? 1 : -1; },
    desc: "a → (); a == 0 ? go right : go left",
    can_jit: false,
  },
  "|": {
    impl: function (thread) { thread.cold =  0; thread.rowd = thread.pop() == 0 ? 1 : -1; },
    desc: "a → (); a == 0 ? go down : go up",
    can_jit: false,
  },
  '"': {
    impl: function (thread) { thread.mode = "string"; },
    desc: "; toggle string mode",
    can_jit: false, // TODO this should be OK, but we'll need JIT for string mode.
    stack_min: 0,
    stack_return: 0,
  },
  ":": {
    impl: function (thread) { thread.stack.push(thread.stack[thread.stack.length-1]); },
    desc: "a → a a",
    can_jit: true,
    stack_min: 1,
    stack_return: 2,
    unchecked_js_code: "stack.push(stack[stack.length-1]);",
  },
  "\\": {
    impl: function (thread) { let a = thread.pop(); var b = thread.pop(); thread.stack.push(a, b); },
    desc: "b a → a b",
    can_jit: true,
    stack_min: 2,
    stack_return: 2,
    unchecked_js_code: "stack.push(stack.pop(), stack.pop());",
  },
  "$": {
    impl: function (thread) { thread.pop(); },
    desc: "a → ()",
    can_jit: true,
    stack_min: 1,
    stack_return: 0,
    unchecked_js_code: "stack.pop();",
  },
  ".": {
    impl: function (thread) { thread.interpreter.out(thread.pop() + " "); },
    desc: "a → (); output a",
    can_jit: false,
  },
  ",": {
    impl: function (thread) { thread.interpreter.out(String.fromCharCode(thread.pop())); },
    desc: "a → (); output chr(a)",
    can_jit: false,
  },
  "#": {
    impl: function (thread) { thread.col += thread.cold; thread.row += thread.rowd; },
    desc: "; jump one cell",
    can_jit: true,
    stack_min: 0,
    stack_return: 0,
    unchecked_js_code: "",
  },
  "g": {
    impl: function (thread) { let row = thread.pop(); var col = thread.pop(); thread.stack.push(get_field(thread, col, row)); },
    desc: "col row → field[row][col]",
    can_jit: true,
    stack_min: 2,
    stack_return: 1,
    unchecked_js_code: "{let row = stack.pop(); stack[stack.length-1] = (get_field(thread, stack[stack.length-1], row));}",
  },
  "p": {
    impl: function (thread) { let row = thread.pop(); var col = thread.pop(); var val = thread.pop(); set_field(thread, col, row, val); },
    desc: "val col row → (); field[row][col] = val",
    can_jit: true,
    stack_min: 3,
    stack_return: 0,
    unchecked_js_code: function (thread_state) {
      return `
          {
            let row = stack.pop();
            let col = stack.pop();
            set_field(thread, col, row, stack.pop());
            for (let i=0; i<jit.path.length; i++) {
              if (jit.path[i][0] == row && jit.path[i][1] == col) {
                thread.row = ${thread_state.row} + ${thread_state.rowd};
                thread.col = ${thread_state.col} + ${thread_state.cold};
                thread.rowd = ${thread_state.rowd};
                thread.cold = ${thread_state.cold};
                return;
              }
            }
          }`},
  },
  "t": {
    impl: function (thread) { thread.interpreter.threads.push(thread.split_thread()); },
    desc: "; create new thread in reverse direction",
    can_jit: false,
  },
  // "&".charCodeAt(0) input number TODO
  // "~".charCodeAt(0) input characte TODO
  "@": {
    impl: function (thread) { thread.interpreter.oute("Normal termination!"); thread.running = false; },
    desc: "; stop current thread",
    can_jit: false,
  },
  " ": {
    impl: function (thread) { },
    desc: "; no-op",
    can_jit: true,
    stack_min: 0,
    stack_return: 0,
    unchecked_js_code: "",
  },
  "(": {
    impl: function (thread) {
      const n = thread.pop();
      let x = 0;
      for(let i=0; i<n; i++) {
        x = x * 256 + thread.pop();
      }
      if (overlays[x]) {
        // We don't support ")" anyway so for now don't
        // need to know how to undo...
        for(let [k, v] of Object.entries(overlays[x])) {
          thread.overlays[k.charCodeAt(0)] = v.impl;
        }
        thread.stack.push(x);
        thread.stack.push(1);
      } else {
        // Failure, reverse direction.
        thread.cold *= -1;
        thread.rowd *= -1;
      }
    },
    desc: "xn ... x1 n → f=(x1 + x2*256 + ... + xn*256^(n-1)) 1 | (); load semantic f or reverse",
    can_jit: false, // Varargs approach makes JIT hard!
  },
};
function gen_fingerprint(s) {
  let x = 0;
  for(let c of Array.from(s).map(x => x.charCodeAt(0))) {
    x = x * 256 + c;
  }
  return x;
}
var overlays = {};
overlays[gen_fingerprint("WS")] = {
  "C": {
    impl: function (thread) {
      let n = thread.pop();
      let url = "";
      for(let i=0; i<n; i++) {
        url += String.fromCharCode(thread.pop());
      }
      console.log(url);
      const socket = new WebSocket(url);
      socket.messages = [];
      socket.addEventListener("message", function (m) { socket.messages.push(m.data); });
      thread.waiter = function (thread) {
        console.log("Waiter: " + socket);
        console.log("readyState: " + socket.readyState);
        if (socket.readyState == 1) {
          thread.stack.push(socket);
          thread.waiter = null;
          return true;
        } else if (socket.readyState == 0) {
          // TODO don't busy-wait this; use open/close -> thread.resolve()
          return false;
        } else {
          // Conection failed!
          thread.cold *= -1;
          thread.rowd *= -1;
          thread.col += thread.cold * 2;
          thread.row += thread.rowd * 2;
          return true;
        }
      };
    },
    desc: "xn ... x1 n → SOCKET | (); connect to websocket x1 .. xn (blocking) or reverse",
    can_jit: false,
  },
  "S": {
    impl: function (thread) {
      let socket = thread.pop();
      console.log(socket);
      let n = thread.pop();
      message = "";
      for(let i=0; i<n; i++) {
        message += String.fromCharCode(thread.pop());
      }
      console.log(socket.readyState);
      if (socket.readyState == 1) {
        socket.send(message);
      } else {
        thread.cold *= -1;
        thread.rowd *= -1;
      }
    },
    desc: "xn ... x1 n SOCKET → (); send message to websocket or reverse if disconnected",
    can_jit: false,
  },
  "R": {
    impl: function (thread) {
      let socket = thread.pop();
      thread.waiter = function (thread) {
        if (socket.messages.length > 0) {
          let message = socket.messages.shift();
          for(let c of message) {
            thread.stack.push(c.charCodeAt(0));
          }
          thread.stack.push(message.length);
          return true;
        } else if (socket.readyState != 1) {
          thread.cold *= -1;
          thread.rowd *= -1;
          return true;
        } else {
          return false;
        }
      };
    },
    desc: "SOCKET → xn ... x1 n; receive message from websocket (blocking) or reverse if disconnected",
    can_jit: false,
  },
  "D": {
    impl: function (thread) {
      thread.pop().close();
    },
    desc: "SOCKET → (); disconnect from websocket",
    can_jit: false,
  },
};
overlays[gen_fingerprint("S")] = {
  "B": {
    impl: function (thread) {
      let count = thread.pop();
      let topush = 0;
      if (thread.stack.length >= count) {
        topush = thread.stack.splice(-count, 1)[0];
      }
      thread.stack.push(topush);
    },
    desc: "y xn ... x1 n-1 → xn ... x1 y",
    can_jit: false,
  },
  "F": {
    impl: function (thread) {
      let count = thread.pop();
      while(thread.stack.length < count) {
        thread.stack.splice(0, 0, 0);
      }
      let topush = thread.pop();
      thread.stack.splice(-count + 1, 0, topush);
    },
    desc: "xn ... x1 y n-1 → y xn ... x1",
    can_jit: false,
  },
};
for(let i=0; i<10; i++) {
  const j = i; // Prevent any capture shenanigans.
  instructions_raw[i] = {
    impl: function (state) { state.stack.push(j); },
    desc: `() → ${i}`,
    can_jit: true,
    stack_min: 0,
    stack_return: 1,
    unchecked_js_code: `stack.push(${i});`,
  };
}
// Fast access instructions array.
let instructions = {};
for(let [s, val] of Object.entries(instructions_raw)) {
  instructions[s.charCodeAt(0)] = val.impl;
}

class Queue {
  /* Structure is a (hopefully short) list of (longer) lists.
   * Queue to the last list.
   * Hold index into first list.
   */
  length = 0;
  index = -1;
  content = [[]];
  max_len = 100;
  push(x) {
    let content = this.content;
    if (content[content.length - 1].length > this.max_len) {
      content.push([]);
    }
    content[content.length - 1].push(x);
    this.length += 1;
  }
  pop() {
    this.index += 1;
    if (this.index >= this.content[0].length) {
      if (this.content.length == 1) {
        throw("empty");
      }
      this.content.shift();
      this.index = 0;
    }
    this.length -= 1;
    return this.content[0][this.index];
  }
}

function deep_copy(obj) {
  return JSON.parse(JSON.stringify(obj));
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

class Interpreter {
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
  input_queue = new Queue(); // Queue things like: change speed, input, etc.

  trigger_event(event_name, ...args) {
    console.log(`Event: ${event_name} -- ${JSON.stringify(args, null, null)}`);
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
    field[row][col] = val;
    document.getElementById("table").children[row].children[col].innerText = val_str == " " ? "\u00a0" : val_str;
    let title = `(${col},${row})=${val} (${val_str})`;
    if (instructions_raw[val_str] !== undefined)
      title += ": " + instructions_raw[val_str].desc;
    document.getElementById("table").children[row].children[col].title = title;
    let dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for(let i=0; i<4; i++) {
      let rowd = dirs[i][0];
      let cold = dirs[i][1];
      let cell_diagonal_index = this.diagonalise_with_dir(row, col, rowd, cold);
      let cell_stats = this.stats[cell_diagonal_index];
      if (cell_stats) {
        console.log(`clearing jit at ${row} ${col} ${rowd} ${cold}`);
        for(let j=0; j<cell_stats.jit_starts.length; j++) {
          console.log(`clearing jit at ${cell_stats.jit_starts[j]}`);
          this.stats[cell_stats.jit_starts[j]] = undefined;
        }
      } else {
        //console.log(`Not clearing jit at ${row} ${col} ${rowd} ${cold}`);
      }
    }
  }
  get_field(state, col, row, val) {
    if (check(state, col, row)) {
      return field[row][col];
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
  diagonalise_positive(row, col) {
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
  diagonalise_any(row, col) {
    /*
        35 21 11 23 39
        20 10  4 12 24
         9  3  0  1  5
        18  8  2  6 14
        31 17  7 15 27
        */
    let shell = Math.abs(row) + Math.abs(col);
    if (shell == 0) return 0
    let prev_shell_indices = 2 * shell * (shell - 1);
    if (row >= 0) {
      return prev_shell_indices + shell + 1 - col;
    } else {
      return prev_shell_indices + 3 * shell + 1 + col;
    }
  }
  diagonalise_with_dir(row, col, rowd, cold) {
    return 4 * this.diagonalise_positive(row, col) + this.diagonalise_any(rowd, cold);
  }
  tick(state, target_ticks, thread_num) {
    //if (true) { } else
    if (!state.jit) {
      let diagonal_index = this.diagonalise_with_dir(state.row, state.col, state.rowd, state.cold);
      let cell_stats = this.stats[diagonal_index];
      if (state.waiter) {
        if (state.waiter(state)) {
          state.waiter = null;
        }
        return 1;
      }
      if (cell_stats) {
        if (cell_stats.jit) {
          let jit = cell_stats.jit;
          if (jit.count <= target_ticks && state.stack.length >= jit.stack_req) {
            state.row = jit.end_row;
            state.col = jit.end_col;
            state.rowd = jit.end_rowd;
            state.cold = jit.end_cold;
            try {
              jit.call(jit, state);
            } catch (err) {
              error(state, `Exception caught in jit: ${err.message}`);
            }
            state.count += jit.count;
            return jit.count;
          }
        } else if (state.mode == "normal") {
          cell_stats.count += 1;
          if (cell_stats.count == 10) {
            console.log(`loop found at ${diagonal_index}?`);
            state.jit = {
              mode: "follow",
              path: [[state.row, state.col, state.rowd, state.cold]],
              code: "",
              stack_req: 0,
              stack_delta: 0,
              count: 0,
            };
          }
        }
      } else {
        this.stats[diagonal_index] = {"count": 1, jit_starts: []};
      }
    } else if (state.jit.mode == "follow") {
      if (state.row == state.jit.path[0][0] && state.col == state.jit.path[0][1] && state.rowd == state.jit.path[0][2] && state.cold == state.jit.path[0][3]) {
        // loop found
        state.jit.mode = "stop";
      }
      state.jit.path.push([state.row, state.col, state.rowd, state.cold]);
      state.jit.count += 1;
    }
    state.count += 1;
    let symbol = field[state.row][state.col];
    if (state.mode == "normal") {
      let instruction = state.overlays[symbol] || instructions[symbol];
      if (state.jit && state.jit.mode == "follow") {
        raw_instruction = instructions_raw[String.fromCharCode(symbol)];
        if (raw_instruction.can_jit && false) {
          state.jit.code += `// ${String.fromCharCode(symbol)} at row ${state.row}, col ${state.col}, heading ${state.rowd}, ${state.cold}\n`;
          let real_code = raw_instruction.unchecked_js_code;
          if (typeof real_code == 'function') {
            real_code = real_code(state);
          }
          state.jit.code += `${real_code}\n`;
          state.jit.stack_req = Math.max(state.jit.stack_req, state.jit.stack_delta - raw_instruction.stack_min);
          state.jit.stack_delta += raw_instruction.stack_return - raw_instruction.stack_min;
        } else {
          state.jit.mode = "stop";
          console.log("Stopping JIT as we're entering an instruction I don't understand.");
          console.log(state.jit)
        }
      }
      if (instruction == null) {
        this.error(state, "Invalid instruction: " + symbol);
      } else {
        try {
          instruction(state, thread_num);
        } catch (err) {
          this.error(state, "Exception caught during " + symbol + ": " + err.message);
          console.log(err.stack);
        }
      }
    } else if (state.mode == "string") {
      if (symbol == '"'.charCodeAt(0)) {
        state.mode = "normal";
      } else {
        state.stack.push(symbol);
      }
    }
    if (state.jit && state.jit.mode == "stop") {
      if (state.jit.count > 0) {
        console.log("Loop found");
        console.log(state.jit.path);
        let code=`jit.call=function (jit, state) {\nlet stack = state.stack;\n${state.jit.code}\n}`;
        console.log(code);
        let resting_place = state.jit.path[state.jit.path.length - 1];
        let jit = {
          end_row: resting_place[0],
          end_col: resting_place[1],
          end_rowd: resting_place[2],
          end_cold: resting_place[3],
          count: state.jit.count,
          path: state.jit.path,
          stack_req: state.jit.stack_req,
          code: code,
        };
        console.log(jit);
        eval(code);
        let starting_place = state.jit.path[0];
        let diagonal_index = this.diagonalise_with_dir(...starting_place);
        for(let i=0; i<state.jit.path.length; i++) {
          let cell_diagonal_index = this.diagonalise_with_dir(...state.jit.path[i]);
          stats[cell_diagonal_index] ||= {count: 0, jit_starts: []};
          this.stats[cell_diagonal_index].jit_starts.push(diagonal_index);
        }
        this.stats[diagonal_index].jit = jit;
      } else {
        console.log(`Abandoning empty JIT attempt`);
        console.log(state.jit);
      }
      state.jit = null;
    }
    state.col += state.cold;
    state.row += state.rowd;
    if (state.row == field.length) state.row = 0;
    else if (state.row == -1) state.row = field.length - 1;
    if (state.col == field[state.row].length) state.col = 0;
    else if (state.col == -1) state.col = field[state.row].length - 1;
    return 1;
  }

  async load_wasm() {
    /* 
          (memory $memory 1)
          (export "memory" (memory $memory))
          (func (export "load_first_item_in_mem") (param) (result i32)
            i32.const 0

            ;; load first item in memory and return the result
            i32.load
            ;; store 10000 in the first location in memory
            i32.const 0
            i32.const 10000
            i32.store
          )
          */
    /*
          (module
  (func $pop (import "my_namespace" "pop") (param i32) (result i32))
  (func $push (import "my_namespace" "push") (param i32 i32))
  (func (export "plus") (param i32)
    local.get 0
    local.get 0
    call $pop
    local.get 0
    call $pop
    i32.add
    call $push
))
*/
    //let wasm_string = "AGFzbQEAAAABBwFgAn9/AX8DAgEABwoBBmFkZFR3bwAACgkBBwAgACABagsACgRuYW1lAgMBAAA=";
    let wasm_string = "AGFzbQEAAAABDwNgAX8Bf2ACf38AYAF/AAIoAgxteV9uYW1lc3BhY2UDcG9wAAAMbXlfbmFtZXNwYWNlBHB1c2gAAQMCAQIHCAEEcGx1cwACChEBDwAgACAAEAAgABAAahABCwAcBG5hbWUBDAIAA3BvcAEEcHVzaAIHAwAAAQACAA==";
    // Fake minus version
    //let wasm_string = "AGFzbQEAAAABDwNgAX8Bf2ACf38AYAF/AAIoAgxteV9uYW1lc3BhY2UDcG9wAAAMbXlfbmFtZXNwYWNlBHB1c2gAAQMCAQIHCAEEcGx1cwACChEBDwAgACAAEAAgABAAaxABCwAcBG5hbWUBDAIAA3BvcAEEcHVzaAIHAwAAAQACAA==";
    let wasm_array = new TextEncoder().encode(atob(wasm_string))
    const importObject = {
      my_namespace: {
        pop: threadNo => this.threads[threadNo].pop(),
        push: (threadNo, i) => this.threads[threadNo].stack.push(i),
      }
    };
    await WebAssembly.compile(wasm_array).then((mod) =>
      WebAssembly.instantiate(mod, importObject).then(instance1 => {
        instance = instance1;
      })
    );
    console.log(instance);
  }
}
var instance;
let interpreter = new Interpreter();
interpreter.load_wasm();
interpreter.input_queue.push(["set_speed", -50]);
interpreter.input_queue.push(["pause"]);
interpreter.input_queue.push(["unpause"]);
interpreter.go();
