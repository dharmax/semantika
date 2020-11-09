import {logger} from "./logger";

export class LoggedException extends Error {

    constructor(message?: string, object?: any) {
        const text = object ? message + ' ' + JSON.stringify(object) : message
        super(text)
        logger.error(this.toString())
    }
}