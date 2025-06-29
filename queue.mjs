export class Queue {
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
