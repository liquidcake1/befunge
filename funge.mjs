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
import { overlay as SOCK_overlay } from "./overlays/SOCK.mjs";
import { overlay as S_overlay } from "./overlays/S.mjs";
import { overlay as WS_overlay } from "./overlays/WS.mjs";

let interpreter = new Interpreter();

interpreter.load_overlay("S", S_overlay);
interpreter.load_overlay("SOCK", SOCK_overlay);
interpreter.load_overlay("WS", WS_overlay);

let instance = await load_wasm(interpreter);

interpreter.field = field;
interpreter.input_queue.push(["set_speed", 100]);
//interpreter.input_queue.push(["set_speed", 90]);
interpreter.input_queue.push(["pause"]);
interpreter.input_queue.push(["unpause"]);
interpreter.add_handler("char_out", function(arg) { process.stdout.write(arg); });
interpreter.add_handler("output_field", function(lines) { lines.forEach(function(line) {process.stdout.write(line + "\n"); })});
interpreter.add_handler("terminate", function() { process.exit(0); });
interpreter.go();
process.stdin.on('data', function (chunk) {
  chunk.forEach(x => interpreter.input_queue.push(["stdin", x]));
});
/*setTimeout(function () {
  console.log("sending @");
  interpreter.input_queue.push(["stdin", "@".charCodeAt(0)]);
}, 2000);*/
