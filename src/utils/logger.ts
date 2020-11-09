export function registerLogger(_logger: ILogger): void {
    logger = _logger
}

interface ILogger {
    warn
    error
    log
    info
}

export let logger: ILogger = console