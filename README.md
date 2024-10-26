Befunge JavaScript thing
========================

It's a toy project, partly written while rushing through things on stream. It's a bit of a mess as a result.

Current status:

* There's a nice-ish interactive editor which works while code is executing. You can copy up/down from a textarea if you like.
* It's got a builtin JS JIT, which makes it run at around 10MHz (over a tight "n=n+1" loop).
* There's a very dumb websocket implementation via a fingerprint which supports reading and writing.
* WIP: Trying to rewrite the JIT using WASM, because 10MHz is downright awful.
