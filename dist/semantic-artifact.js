"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticArtifact = void 0;
const semantic_package_1 = require("./semantic-package");
class SemanticArtifact {
    constructor(sp, _id) {
        this._id = _id;
        this._semanticPackageName = sp.name;
        this.id = _id;
    }
    get semanticPackage() {
        return semantic_package_1.SemanticPackage.findSemanticPackage(this._semanticPackageName);
    }
}
exports.SemanticArtifact = SemanticArtifact;
//# sourceMappingURL=semantic-artifact.js.map