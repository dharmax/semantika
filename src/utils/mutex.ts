import {EventEmitter} from 'events'

export class Mutex {
    private static event = Symbol()
    private locked = false
    private queue = new EventEmitter()

    constructor() {
        this.queue.setMaxListeners(100)
    }

    lock(fn) {
        if (this.locked) {
            this.queue.once(Mutex.event, () => this.lock(fn))
        } else {
            this.locked = true
            fn()
        }
    }

    release() {
        this.locked = false
        this.queue.emit(Mutex.event)
    }
}


