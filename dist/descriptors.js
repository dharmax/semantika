"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PredicateDcr = exports.EntityDcr = exports.SemanticPartDescriptor = void 0;
const semantic_package_1 = require("./semantic-package");
/**
 * This is the abstract parent of all descriptors. Descriptors are the ontology of your model and as ontologies go, they
 * can be hierarchical which means, a descriptor inherits the *semantic meaning* of its parent - a useful fact that
 * reflects on the queries you can make. As with their counterparts, (entities and predicates) they belong to semantic-packages
 * where the rules of inheritance also apply.
 */
class SemanticPartDescriptor {
    constructor() {
        this._parents = [];
    }
    get semanticPackage() {
        return semantic_package_1.SemanticPackage.findSemanticPackage(this.semanticPackageName);
    }
    set semanticPackage(sp) {
        this.semanticPackageName = sp.name;
    }
}
exports.SemanticPartDescriptor = SemanticPartDescriptor;
/**
 * Holds meta-data for an entity-type and semantically defines it. Usually, a entity type is represented by its own JS
 * class but theoretically one JS class may represent more than one entity type, but they must have separate descriptors.
 */
class EntityDcr extends SemanticPartDescriptor {
    /**
     * @param clazz the JS class that represents the entity type
     * @param template the template definition of the entities' fields
     * @param _name (optional) alternative name for the dcr (it's the class name by default)
     */
    constructor(clazz, template, _name) {
        super();
        this.clazz = clazz;
        this.template = template;
        this._name = _name;
    }
    get name() {
        return this._name || this.clazz.name;
    }
    get parents() {
        return this._parents;
    }
}
exports.EntityDcr = EntityDcr;
/**
 * Predicate descriptor denotes the type of the descriptor and it's supposed to have a semantically meaningful name to
 * the relevant business logic.
 */
class PredicateDcr extends SemanticPartDescriptor {
    /**
     *
     * @param name the meaningful name of these predicates
     * @param children sub-predicates
     * @param keys optional extra keys (indexed)
     * @param payload template for user payload
     * @param rules rules for what may be connected by the predicate
     */
    constructor(name, children = [], keys = {
        source: [],
        target: [],
        self: []
    }, payload, rules) {
        super();
        this.name = name;
        this.children = children;
        this.keys = keys;
        this.payload = payload;
        this.rules = rules;
    }
    get parents() {
        // @ts-ignore
        return this._parents;
    }
}
exports.PredicateDcr = PredicateDcr;
//# sourceMappingURL=descriptors.js.map