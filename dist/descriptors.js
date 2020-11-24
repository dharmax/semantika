"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.PredicateDcr = exports.EntityDcr = exports.SemanticPartDescriptor = void 0;

class SemanticPartDescriptor {
    constructor() {
        this._parents = [];
    }
}

exports.SemanticPartDescriptor = SemanticPartDescriptor;

class EntityDcr extends SemanticPartDescriptor {
    constructor(clazz, template) {
        super();
        this.clazz = clazz;
        this.template = template;
    }

    get name() {
        return this.clazz.name;
    }

    get parents() {
        return this._parents;
    }
}

exports.EntityDcr = EntityDcr;

class PredicateDcr extends SemanticPartDescriptor {
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