"use strict";
import * as events from "events";

export class Mutex {
    private queue: any;
    private locked: boolean;
    private static event = Symbol()
    constructor() {
        this.locked = false;
        this.queue = new events.EventEmitter();
        this.queue.setMaxListeners(100);
    }
    lock(fn) {
        if (this.locked) {
            this.queue.once(Mutex.event, () => this.lock(fn));
        }
        else {
            this.locked = true;
            fn();
        }
    }
    release() {
        this.locked = false;
        this.queue.emit(Mutex.event);
    }
}
//# sourceMappingURL=mutex.js.map