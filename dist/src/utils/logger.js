"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.logger = exports.registerLogger = void 0;

/**
 * Use this to register your own logger
 * @param _logger
 */
function registerLogger(_logger) {
    exports.logger = _logger;
}

exports.registerLogger = registerLogger;
exports.logger = console;
//# sourceMappingURL=logger.js.map