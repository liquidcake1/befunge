export function load_wasm(interpreter) {
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
      pop: threadNo => interpreter.threads[threadNo].pop(),
      push: (threadNo, i) => interpreter.threads[threadNo].stack.push(i),
    }
  };
  return WebAssembly.compile(wasm_array).then((mod) =>
    WebAssembly.instantiate(mod, importObject).then(instance => {
      patch_interpreter(interpreter, instance);
      return instance;
    })
  );
}
function patch_interpreter(interpreter, instance) {
  interpreter.instructions_raw["+"].impl = function (thread, thread_num) { instance.exports.plus(thread_num); };
  interpreter.instructions["+".charCodeAt(0)] = function (thread, thread_num) { instance.exports.plus(thread_num); };
}
