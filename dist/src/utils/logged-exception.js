"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.LoggedException = void 0;
const logger_1 = require("./logger");
class LoggedException extends Error {
    constructor(message, object) {
        const text = object ? message + ' ' + JSON.stringify(object) : message;
        super(text);
        logger_1.logger.error(this.toString());
    }
}
exports.LoggedException = LoggedException;
//# sourceMappingURL=logged-exception.js.map