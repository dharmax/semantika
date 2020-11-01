
export class LoggedException extends Error {

    constructor(message?: string, object?: any) {
        const text = object ? message + ' ' + JSON.stringify(object) : message
        super(text)
        console.exception(text)
    }
}