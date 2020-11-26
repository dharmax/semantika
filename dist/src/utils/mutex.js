"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.Mutex = void 0;
const events_1 = require("events");
class Mutex {
    constructor() {
        this.locked = false;
        this.queue = new events_1.EventEmitter();
        this.queue.setMaxListeners(100);
    }
    lock(fn) {
        if (this.locked) {
            this.queue.once(Mutex.event, () => this.lock(fn));
        } else {
            this.locked = true;
            fn();
        }
    }
    release() {
        this.locked = false;
        this.queue.emit(Mutex.event);
    }
}
exports.Mutex = Mutex;
Mutex.event = Symbol();
//# sourceMappingURL=mutex.js.map