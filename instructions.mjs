export let instructions_raw = {
  "+": {
    impl: function (thread) { thread.stack.push(-thread.pop() + thread.pop()); },
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
  // "&" input character TODO
  "~": { // TODO handle EOF properly (push nothing)
    impl: function (thread) {
      if (thread.interpreter.stdin_queue.length > 0) {
        console.log("Have data!");
        thread.stack.push(thread.interpreter.stdin_queue.pop());
      } else {
        console.log("Have no data!");
        return new Promise(r => thread.interpreter.stdin_waiters.push(r)).then(function (char_code) {thread.stack.push(char_code); thread.blocked = false;});
      }
    },
    desc: "() → x; read a character from input",
    can_jit: false,
  },
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

// Add numbers 0-9
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
export let instructions = {};
for(let [s, val] of Object.entries(instructions_raw)) {
  instructions[s.charCodeAt(0)] = val.impl;
}
