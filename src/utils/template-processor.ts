import * as joi from 'joi';
import {LoggedException} from "./logged-exception.js";

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
export function processTemplate(template: Object, givenFields: Object, superSetAllowed: boolean, strict: boolean, entityType: string, update: boolean = false) {
    if (superSetAllowed && !strict || !template)
        return givenFields;
    const fields: Record<string, any> = {};
    const templateKeys = new Set(Object.keys(template));
    // validate the fields provided according to template.
    for (let [fn, fv] of Object.entries(givenFields)) {
        if (templateKeys.has(fn)) {
            const templateEntry = (template as any)[fn];
            const validator = templateEntry && templateEntry['validate'];
            if (validator) {
                const {error, value} = templateEntry.validate(fv);
                if (error)
                    throw new LoggedException(`field '${fn}' in entity ${entityType} doesn't match template rules. It was ${fv}\n ${error}`);
                fv = value;
            }
            fields[fn] = fv;
        } else {
            if (!strict)
                throw new LoggedException(`Writing a field ${fn} that is not within the template of ${entityType}`);
            else {
                console.warn(`Writing a field ${fn} that is not within the template of ${entityType}`);
            }
        }
    }
    // populate automatic fields / default values
    if (!update) for (let [fn, fv] of Object.entries(template)) {
        if ((givenFields as any)[fn] != undefined || fv == undefined)
            continue;
        if (typeof fv === 'object' && typeof (fv as any).validate === 'function') {
            const {error, value} = (fv as any).validate(undefined);
            if (!error && value !== undefined) {
                fields[fn] = value;
            }
            continue;
        }
        fields[fn] = (typeof fv == 'function') ? fv(givenFields) : fv;
    }
    return fields;
}

export type EntityTemplate = { [fieldName: string]: joi.Schema | any };