export let overlay = {
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
}
