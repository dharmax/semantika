"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.processTemplate = void 0;
const logged_exception_1 = require("./logged-exception");

/**
 * Takes an object template definition, data fields and process it. Processing it means, validating, setting
 * default values, removal or warning if extraneous fields found
 * @param template - the template. Each key may have either a default value, nothing or a validator (an object with a 'validate' method)
 * @param givenFields - the data fields to process
 * @param superSetAllowed - if true, then it means the given fields may include fields that aren't on the template
 * @param strict - true: exception on extraneous field, false - just a warning
 * @param entityType - related entity name (may be empty)
 * @param update - if true, it doesn't populate automatic fields
 */
function processTemplate(template, givenFields, superSetAllowed, strict, entityType, update = false) {
    if (superSetAllowed && !strict || !template)
        return givenFields;
    const fields = {};
    const templateKeys = new Set(Object.keys(template));
    // validate the fields provided according to template.
    for (let [fn, fv] of Object.entries(givenFields)) {
        if (templateKeys.has(fn)) {
            const templateEntry = template[fn];
            const validator = templateEntry && templateEntry['validate'];
            if (validator) {
                const {error, value} = templateEntry.validate(fv);
                if (error)
                    throw new logged_exception_1.LoggedException(`field '${fn}' in entity ${entityType} doesn't match template rules. ${error}`);
                fv = value;
            }
            fields[fn] = fv;
        } else {
            if (!strict)
                throw new logged_exception_1.LoggedException(`Writing a field ${fn} that is not within the template of ${entityType}`);
            else {
                console.warn(`Writing a field ${fn} that is not within the template of ${entityType}`);
            }
        }
    }
    // populate automatic fields
    if (!update)
        for (let [fn, fv] of Object.entries(template)) {
            // skip fields that were populated manually
            if (givenFields[fn] != undefined || fv == undefined || fv['validate'])
                continue;
            fields[fn] = (typeof fv == 'function') ? fv(givenFields) : fv;
        }
    return fields;
}

exports.processTemplate = processTemplate;
//# sourceMappingURL=template-processor.js.map