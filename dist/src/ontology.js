"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.Ontology = void 0;
const logged_exception_1 = require("./utils/logged-exception");
class Ontology {
    constructor(semanticPackage, definitions) {
        this.semanticPackage = semanticPackage;
        this.definitions = definitions;
        this.predicateDcrs = {};
        this.entityDcrs = {};
        const self = this;
        let allPdcrs = this.predicateDcrs;
        process(definitions.predicateDcrs);
        function process(predicateDcrs, parent = undefined) {
            definitions.entityDcrs.forEach(e => {
                self.entityDcrs[e.name] = e;
                self.entityDcrs[e.name].semanticPackage = semanticPackage;
            });
            for (let pd of predicateDcrs) {
                const e = allPdcrs[pd.name];
                if (e)
                    throw new logged_exception_1.LoggedException('Duplicate predicate descriptor: ' + pd.name);
                allPdcrs[pd.name] = pd;
                pd.semanticPackage = self.semanticPackage;
                pd.parents.forEach(pParent => {
                    if (!pParent.children.includes(pd))
                        pParent.children.push(pd);
                });
                if (parent && !pd.parents.includes(parent))
                    pd.parents.push(parent);
                pd.children && process(pd.children);
            }
        }
    }
    pdcr(name) {
        const res = this.predicateDcrs[name];
        if (!res)
            throw new logged_exception_1.LoggedException('No such predicate descriptor ' + name);
        return res;
    }
    edcr(name) {
        const res = this.entityDcrs[name];
        if (!res)
            throw new logged_exception_1.LoggedException('No such entity descriptor ' + name);
        return res;
    }
    edcrNames() {
        return Object.keys(this.entityDcrs);
    }
}
exports.Ontology = Ontology;
//# sourceMappingURL=ontology.js.map