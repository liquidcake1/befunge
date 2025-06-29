let file_name = process.argv[2];

import { readFileSync } from "fs";

let field_s = readFileSync(file_name, "utf8");
console.log(field_s);

let field = field_s.split("\n");
field.pop();
field = field.map( x => x.split("").map( c => c.charCodeAt(0) ) );
console.log(field);

import { Interpreter } from "./interpreter.mjs";
import { load_wasm } from "./wasm.mjs";
let interpreter = new Interpreter();
let instance = await load_wasm(interpreter);
interpreter.field = field;
interpreter.input_queue.push(["set_speed", -50]);
interpreter.input_queue.push(["pause"]);
interpreter.input_queue.push(["unpause"]);
interpreter.go();
process.stdin.on('data', function (chunk) {
  chunk.forEach(x => interpreter.input_queue.push(["stdin", x]));
});
setTimeout(function () {
  console.log("sending @");
  interpreter.input_queue.push(["stdin", "@".charCodeAt(0)]);
}, 2000);
