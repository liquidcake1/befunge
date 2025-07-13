import net from 'node:net';
export let overlay = {
  "C": {
    impl: function (thread) {
      let n = thread.pop();
      let host = "";
      for(let i=0; i<n; i++) {
        host += String.fromCharCode(thread.pop());
      }
      let port = thread.pop();
      const socket = new net.Socket();
      socket.connect(port, host);
      socket.messages = [];
      socket.on('data', function (data) { socket.messages.push(data.toString('utf8')); });
      thread.waiter = function (thread) {
        //console.log("readyState: " + socket.readyState);
        if (socket.readyState == "open") {
          thread.stack.push(socket);
          thread.waiter = null;
          return true;
        } else if (socket.readyState == "opening") {
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
      //console.log("S: " + socket);
      let n = thread.pop();
      //console.log("S: " + n);
      let message = "";
      for(let i=0; i<n; i++) {
        message += String.fromCharCode(thread.pop());
        //console.log("S: message: " + message);
      }
      //console.log("Write: readyState: " + socket.readyState);
      if (socket.readyState == "open") {
        socket.write(message);
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
      if (socket.messages === undefined) {
        console.log("Not a socket: " + socket);
        throw("Not a socket!");
      }
      thread.waiter = function (thread) {
        //console.log(`Write: ${socket} readyState: ${socket.readyState}`);
        if (socket.messages.length > 0) {
          let message = socket.messages.shift();
          for(let c of message.split("").reverse()) {
            thread.stack.push(c.charCodeAt(0));
          }
          thread.stack.push(message.length);
          return true;
        } else if (socket.readyState != "open") {
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
      thread.pop().destroySoon();
    },
    desc: "SOCKET → (); disconnect from websocket",
    can_jit: false,
  },
}
