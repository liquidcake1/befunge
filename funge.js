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

let field = [
	[" ".charCodeAt(0), '9'.charCodeAt(0), "9".charCodeAt(0), '9'.charCodeAt(0), "9".charCodeAt(0), "v".charCodeAt(0), " ".charCodeAt(0)],
	[",".charCodeAt(0), "+".charCodeAt(0), "+".charCodeAt(0), "+".charCodeAt(0), "9".charCodeAt(0), "<".charCodeAt(0), "@".charCodeAt(0)],
];

let file_name = process.argv[2];
let field_s = require("fs").readFileSync(file_name);
console.log(field_s);


let run_state = {
	max_loops: 1000,
	paused_wake: null,
	paused_event: null,
	slice_loops: 1,
	slice_sleep: 20,
	running: false,
	threads: [],
	events: {},
};

function trigger_event(event_name, ...args) {
	console.log(`Event: ${event_name} -- ${JSON.stringify(args, null, null)}`);
}

function set_speed(raw_speed) {
	if (raw_speed > 0) {
		run_state.slice_sleep = 1;
		run_state.slice_loops = Math.floor(1.1 ** raw_speed);
	} else {
		run_state.slice_sleep = Math.floor(1.1 ** -raw_speed);
		run_state.slice_loops = 1;
	}
}

function toggle_pause(e) {
	if (run_state.paused_wake === null) {
		pause();
	} else {
		unpause();
	}
}
function pause() {
	run_state.paused_event = new Promise(function (r) {
		run_state.paused_wake = r;
		// We shouldn't be in the sleep loop if paused.
		if (awake_sleep != null) awake_sleep();
	});
	trigger_event("paused", true);
	run_state.threads.forEach(function (thread) {
		trigger_event("thread_paused", thread, true);
	});
}
function unpause() {
	let old_wake = run_state.paused_wake;
	run_state.paused_wake = null;
	trigger_event("paused", false);
	run_state.threads.forEach(function (thread) {
		trigger_event("thread_paused", thread, false)
	});
}

async function sleep_until_unpaused() { // TODO???
	if (!run_state.paused_event)
		await sleep(run_state.slice_sleep);
	if (run_state.paused_event) {
		let paused_event = run_state.paused_event;
		run_state.paused_event = null;
		unpause_data = await paused_event;
		return unpause_data;
	}
}

function step(e) { // TODO ???
	let old_wake = run_state.paused_wake;
	pause();
	if (old_wake !== null) {
		old_wake({count: 1});
	}
}
function step_thread(thread) { // ???
	let old_wake = run_state.paused_wake;
	pause();
	if (old_wake !== null) {
		old_wake({threads: [thread], count: 1});
	}
}

function new_thread(col, row, cold, rowd, stack, overlays) {
	let thread = {
		"col": col,
		"row": row,
		"cold": cold,
		"rowd": rowd,
		running: true,
		mode: "normal",
		jit: null,
		stack: stack,
		info_elt: null,
		tick_count: 0,
		overlays: overlays || {},
	};
	return thread;
}

function split_thread(old_thread) {
	let thread = new_thread(
		old_thread.col - old_thread.cold,
		old_thread.row - old_thread.rowd,
		-old_thread.cold,
		-old_thread.rowd,
		JSON.parse(JSON.stringify(old_thread.stack)),
		JSON.parse(JSON.stringify(old_thread.overlays)),
	);
	thread.tick_count = old_thread.tick_count; // Ensure new thread has equal priority to old thread.
	return thread;
}

async function go() {
	stop();
	if (run_state.running_promise != null) {
		console.log("Waiting for last thread to exit");
		await run_state.running_promise;
		console.log("Last thread has exited");
	}
	let thread = new_thread(0, 0, 1, 0, []);
	run_state.threads.push(thread);
	main_loop();
}

function stop() {
	run_state.threads.forEach(function (thread) { thread.running = false; });
	unpause();
	if (awake_sleep != null) awake_sleep();
}

function pop(state) {
	if (state.stack.length > 0) {
		return state.stack.pop();
	} else {
		error(state, "Stack underflow");
		return 0;
	}
}

function check(state, row, col) {
	if (row < 0 || row >= height) error(state, `Row ${row} is out of bounds`);
	else if (col < 0 || col >= height) error(state, `Col ${col} is out of bounds`);
	else return true;
}
function set_field(state, col, row, val) {
	if (check(state, col, row)) {
		set_cell(document.getElementById("table").children[row].children[col], col, row, val);
	} else {
		console.log(`out of bounds access ${state} ${col} ${row} ${val}`);
	}
}
function set_cell(cell, col, row, val) {
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
		let cell_diagonal_index = diagonalise_with_dir(row, col, rowd, cold);
		let cell_stats = stats[cell_diagonal_index];
		if (cell_stats) {
			console.log(`clearing jit at ${row} ${col} ${rowd} ${cold}`);
			for(let j=0; j<cell_stats.jit_starts.length; j++) {
				console.log(`clearing jit at ${cell_stats.jit_starts[j]}`);
				stats[cell_stats.jit_starts[j]] = undefined;
			}
		} else {
			//console.log(`Not clearing jit at ${row} ${col} ${rowd} ${cold}`);
		}
	}
}
function get_field(state, col, row, val) {
	if (check(state, col, row)) {
		return field[row][col];
	}
}
let instructions_raw = {
	"+": {
		impl: function (state, thread_num) { instance.exports.plus(thread_num); },
		//impl: function (state) { state.stack.push(-pop(state) + pop(state)); },
		desc: "b a → b + a",
		can_jit: true,
		jit_pop: 2,
		jit_push: 1,
		jit_code: "stack[stack.length - 2] += stack.pop();",
	},
	"-": {
		impl: function (state) { state.stack.push(-pop(state) + pop(state)); },
		desc: "b a → b - a",
		can_jit: true,
		jit_pop: 2,
		jit_push: 1,
		jit_code: "stack[stack.length - 2] -= stack.pop();",
	},
	"*": {
		impl: function (state) { state.stack.push(pop(state) * pop(state)); },
		desc: "b a → b * a",
		can_jit: true,
		jit_pop: 2,
		jit_push: 1,
		jit_code: "stack[stack.length - 2] *= stack.pop();",
	},
	"/": {
		impl: function (state) { let a = pop(state); let b = pop(state); state.stack.push(Math.floor(b / a)); },
		desc: "b a → b // a",
		can_jit: true,
		jit_pop: 2,
		jit_push: 1,
		jit_code: "stack[stack.length - 2] /= stack.pop();",
	},
	"%": {
		impl: function (state) { let a = pop(state); let b = pop(state); state.stack.push(b % a); },
		desc: "b a → b % a",
		can_jit: true,
		jit_pop: 2,
		jit_push: 1,
		jit_code: "stack[stack.length - 2] %= stack.pop();",
	},
	"!": {
		impl: function (state) { state.stack.push(pop(state) == 0 ? 1 : 0); },
		desc: "a → a == 0 ? 1 : 0",
		can_jit: true,
		jit_pop: 1,
		jit_push: 1,
		jit_code: "stack[stack.length - 1] = stack[stack.length - 1] ? 1 : 0;",
	},
	"`": {
		impl: function (state) { state.stack.push(pop(state) < pop(state) ? 1 : 0); },
		desc: "b a → b > a ? 1 : 0",
		can_jit: true,
		jit_pop: 2,
		jit_push: 1,
		jit_code: "stack[stack.length - 2] = stack.pop() < stack[stack.length - 1] ? 0 : 1;",
	},
	"<": {
		impl: function (state) { state.cold = -1; state.rowd =  0; },
		desc: "() → (); go left",
		jit_pop: 0,
		jit_push: 0,
		jit_code: "",
		can_jit: true,
	},
	">": {
		impl: function (state) { state.cold =  1; state.rowd =  0; },
		desc: "() → (); go right",
		jit_pop: 0,
		jit_push: 0,
		jit_code: "",
		can_jit: true,
	},
	"^": {
		impl: function (state) { state.cold =  0; state.rowd = -1; },
		desc: "() → (); go up",
		jit_pop: 0,
		jit_push: 0,
		jit_code: "",
		can_jit: true,
	},
	"v": {
		impl: function (state) { state.cold =  0; state.rowd =  1; },
		desc: "() → (); go down",
		jit_pop: 0,
		jit_push: 0,
		jit_code: "",
		can_jit: true,
	},
	"?": {
		impl: function (state) { let x = Math.floor(Math.random() * 4); state.cold = ((x % 2) * 2 - 1) * Math.floor(x / 2); state.rowd = ((x % 2) * 2 - 1) * ( 1 - Math.floor(x / 2)); },
		desc: "() → (); go random cardinal",
		can_jit: false,
	},
	"_": {
		impl: function (state) { state.rowd =  0; state.cold = pop(state) == 0 ? 1 : -1; },
		desc: "a → (); a == 0 ? go right : go left",
		can_jit: false,
	},
	"|": {
		impl: function (state) { state.cold =  0; state.rowd = pop(state) == 0 ? 1 : -1; },
		desc: "a → (); a == 0 ? go down : go up",
		can_jit: false,
	},
	'"': {
		impl: function (state) { state.mode = "string"; },
		desc: "; toggle string mode",
		can_jit: false, // TODO this should be OK, but we'll need JIT for string mode.
		jit_pop: 0,
		jit_push: 0,
	},
	":": {
		impl: function (state) { state.stack.push(state.stack[state.stack.length-1]); },
		desc: "a → a a",
		can_jit: true,
		jit_pop: 1,
		jit_push: 2,
		jit_code: "stack.push(stack[stack.length-1]);",
	},
	"\\": {
		impl: function (state) { let a = pop(state); var b = pop(state); state.stack.push(a, b); },
		desc: "b a → a b",
		can_jit: true,
		jit_pop: 2,
		jit_push: 2,
		jit_code: "stack.push(stack.pop(), stack.pop());",
	},
	"$": {
		impl: function (state) { pop(state); },
		desc: "a → ()",
		can_jit: true,
		jit_pop: 1,
		jit_push: 0,
		jit_code: "stack.pop();",
	},
	".": {
		impl: function (state) { out(pop(state) + " "); },
		desc: "a → (); output a",
		can_jit: false,
	},
	",": {
		impl: function (state) { out(String.fromCharCode(pop(state))); },
		desc: "a → (); output chr(a)",
		can_jit: false,
	},
	"#": {
		impl: function (state) { state.col += state.cold; state.row += state.rowd; },
		desc: "; jump one cell",
		can_jit: true,
		jit_pop: 0,
		jit_push: 0,
		jit_code: "",
	},
	"g": {
		impl: function (state) { let row = pop(state); var col = pop(state); state.stack.push(get_field(state, col, row)); },
		desc: "col row → field[row][col]",
		can_jit: true,
		jit_pop: 2,
		jit_push: 1,
		jit_code: "{let row = stack.pop(); stack[stack.length-1] = (get_field(state, stack[stack.length-1], row));}",
	},
	"p": {
		impl: function (state) { let row = pop(state); var col = pop(state); var val = pop(state); set_field(state, col, row, val); },
		desc: "val col row → (); field[row][col] = val",
		can_jit: true,
		jit_pop: 3,
		jit_push: 0,
		jit_code: function (thread_state) {
			return `
					{
						let row = stack.pop();
						let col = stack.pop();
						set_field(state, col, row, stack.pop());
						for (let i=0; i<jit.path.length; i++) {
							if (jit.path[i][0] == row && jit.path[i][1] == col) {
								state.row = ${thread_state.row} + ${thread_state.rowd};
								state.col = ${thread_state.col} + ${thread_state.cold};
								state.rowd = ${thread_state.rowd};
								state.cold = ${thread_state.cold};
								return;
							}
						}
					}`},
	},
	"t": {
		impl: function (state) { run_state.threads.push(split_thread(state)); },
		desc: "; create new thread in reverse direction",
		can_jit: false,
	},
	// "&".charCodeAt(0) input number TODO
	// "~".charCodeAt(0) input characte TODO
	"@": {
		impl: function (state) { oute("Normal termination!"); state.running = false; },
		desc: "; stop current thread",
		can_jit: false,
	},
	" ": {
		impl: function (state) { },
		desc: "; no-op",
		can_jit: true,
		jit_pop: 0,
		jit_push: 0,
		jit_code: "",
	},
	"(": {
		impl: function (state) {
			const n = pop(state);
			let x = 0;
			for(let i=0; i<n; i++) {
				x = x * 256 + pop(state);
			}
			if (overlays[x]) {
				// We don't support ")" anyway so for now don't
				// need to know how to undo...
				for(let [k, v] of Object.entries(overlays[x])) {
					state.overlays[k.charCodeAt(0)] = v.impl;
				}
				state.stack.push(x);
				state.stack.push(1);
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
		impl: function (state) {
			let n = pop(state);
			let url = "";
			for(let i=0; i<n; i++) {
				url += String.fromCharCode(pop(state));
			}
			console.log(url);
			const socket = new WebSocket(url);
			socket.messages = [];
			socket.addEventListener("message", function (m) { socket.messages.push(m.data); });
			state.waiter = function (state) {
				console.log("Waiter: " + socket);
				console.log("readyState: " + socket.readyState);
				if (socket.readyState == 1) {
					state.stack.push(socket);
					state.waiter = null;
					return true;
				} else if (socket.readyState == 0) {
					// TODO don't busy-wait this; use open/close -> state.resolve()
					return false;
				} else {
					// Conection failed!
					state.cold *= -1;
					state.rowd *= -1;
					state.col += state.cold * 2;
					state.row += state.rowd * 2;
					return true;
				}
			};
		},
		desc: "xn ... x1 n → SOCKET | (); connect to websocket x1 .. xn (blocking) or reverse",
		can_jit: false,
	},
	"S": {
		impl: function (state) {
			let socket = pop(state);
			console.log(socket);
			let n = pop(state);
			message = "";
			for(let i=0; i<n; i++) {
				message += String.fromCharCode(pop(state));
			}
			console.log(socket.readyState);
			if (socket.readyState == 1) {
				socket.send(message);
			} else {
				state.cold *= -1;
				state.rowd *= -1;
			}
		},
		desc: "xn ... x1 n SOCKET → (); send message to websocket or reverse if disconnected",
		can_jit: false,
	},
	"R": {
		impl: function (state) {
			let socket = pop(state);
			state.waiter = function (state) {
				if (socket.messages.length > 0) {
					let message = socket.messages.shift();
					for(let c of message) {
						state.stack.push(c.charCodeAt(0));
					}
					state.stack.push(message.length);
					return true;
				} else if (socket.readyState != 1) {
					state.cold *= -1;
					state.rowd *= -1;
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
		impl: function (state) {
			pop(state).close();
		},
		desc: "SOCKET → (); disconnect from websocket",
		can_jit: false,
	},
};
overlays[gen_fingerprint("S")] = {
	"B": {
		impl: function (state) {
			let count = pop(state);
			let topush = 0;
			if (state.stack.length >= count) {
				topush = state.stack.splice(-count, 1)[0];
			}
			state.stack.push(topush);
		},
		desc: "y xn ... x1 n-1 → xn ... x1 y",
		can_jit: false,
	},
	"F": {
		impl: function (state) {
			let count = pop(state);
			while(state.stack.length < count) {
				state.stack.splice(0, 0, 0);
			}
			let topush = pop(state);
			state.stack.splice(-count + 1, 0, topush);
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
		jit_pop: 0,
		jit_push: 1,
		jit_code: `stack.push(${i});`,
	};
}
// Fast access instructions array.
let instructions = {};
for(let [s, val] of Object.entries(instructions_raw)) {
	instructions[s.charCodeAt(0)] = val.impl;
}

function out(s) {
	console.log("Out: " + s);
}
function oute(s) {
	console.log("Err: " + s);
}
function outnl() {
	console.log("Outnl");
}
function error(state, message) {
	state.running = false;
	output_error(state, message);
}
function output_error(state, message) {
	oute(`ERROR: ${message}`);
	oute(`State was: ${JSON.stringify(state)}`);
}

let awake_sleep = null;
async function sleep(ms) {
	await new Promise(r => { awake_sleep = r; setTimeout(r, ms) });
	awake_sleep = null;
}
async function main_loop() {
	let ticks = 0;
	run_state.running = true;
	let running_wake = null;
	run_state.running_promise = new Promise(r => { running_wake = r; });
	let highlighted_cells = [];
	let start_time = new Date().getTime();
	while(run_state.threads.length > 0) {
		let slice_loops = run_state.slice_loops;
		let limit_threads = null;
		let need_sleep = true;

		run_state.threads.forEach(thread => trigger_event("thread_state_updated", thread));
		trigger_event("thread_state_synced");

		if (ticks > run_state.max_loops) {
			let end_time = new Date().getTime();
			oute(`Ran out of ticks! (${ticks} > ${document.getElementById("max_loops").value})`);
			console.log(`${ticks} in ${end_time - start_time} is ${ticks / (end_time - start_time) / 1000} MHz`);
			pause();
		}

		let unpause_data = await sleep_until_unpaused();
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
		while(count < slice_loops && run_state.threads.length > 0) {
			// This will _not_ iterate over newly-added threads.
			let to_iter = limit_threads !== null ? limit_threads : run_state.threads;
			let min_count = Math.min(...to_iter.map(x => x.tick_count));
			to_iter.forEach((thread, i) => {
				if (thread.tick_count == min_count) {
					let tick_count = tick(thread, slice_loops - count, i);
					count += tick_count;
					thread.tick_count += tick_count;
				}
			});
			let new_dead_threads = run_state.threads.filter(t => !t.running);
			if (new_dead_threads) {
				dead_threads.push(...new_dead_threads);
				run_state.threads = run_state.threads.filter(t => t.running);
			}
		}

		dead_threads.forEach(
			dead_thread => trigger_event("thread_dead", dead_thread));

		ticks += count;
	}
	trigger_event("terminate");
	running_wake();
	console.log(`exited main_loop with ticks ${ticks}`);
}
function diagonalise_positive(row, col) {
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
function diagonalise_any(row, col) {
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
function diagonalise_with_dir(row, col, rowd, cold) {
	return 4 * diagonalise_positive(row, col) + diagonalise_any(rowd, cold);
}
let stats = [];
function tick(state, target_ticks, thread_num) {
	//if (true) { } else
	if (!state.jit) {
		let diagonal_index = diagonalise_with_dir(state.row, state.col, state.rowd, state.cold);
		let cell_stats = stats[diagonal_index];
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
			stats[diagonal_index] = {"count": 1, jit_starts: []};
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
				let real_code = raw_instruction.jit_code;
				if (typeof real_code == 'function') {
					real_code = real_code(state);
				}
				state.jit.code += `${real_code}\n`;
				state.jit.stack_req = Math.max(state.jit.stack_req, state.jit.stack_delta - raw_instruction.jit_pop);
				state.jit.stack_delta += raw_instruction.jit_push - raw_instruction.jit_pop;
			} else {
				state.jit.mode = "stop";
				console.log("Stopping JIT as we're entering an instruction I don't understand.");
				console.log(state.jit)
			}
		}
		if (instruction == null) {
			error(state, "Invalid instruction: " + symbol);
		} else {
			try {
				instruction(state, thread_num);
			} catch (err) {
				error(state, "Exception caught: " + err.message);
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
			let diagonal_index = diagonalise_with_dir(...starting_place);
			for(let i=0; i<state.jit.path.length; i++) {
				let cell_diagonal_index = diagonalise_with_dir(...state.jit.path[i]);
				stats[cell_diagonal_index] ||= {count: 0, jit_starts: []};
				stats[cell_diagonal_index].jit_starts.push(diagonal_index);
			}
			stats[diagonal_index].jit = jit;
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

async function load_wasm() {
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
			pop: threadNo => pop(run_state.threads[threadNo]),
			push: (threadNo, i) => run_state.threads[threadNo].stack.push(i),
		}
	};
	await WebAssembly.compile(wasm_array).then((mod) =>
		WebAssembly.instantiate(mod, importObject).then(instance1 => {
			instance = instance1;
		})
	);
	console.log(instance);
}
load_wasm();
go();
