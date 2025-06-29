export let overlay = {
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
}
