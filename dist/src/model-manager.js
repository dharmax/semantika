"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.idAndType2entity = exports.Predicate = void 0;
const logged_exception_1 = require("./utils/logged-exception");
class Predicate {
    constructor(semanticPackage, record) {
        this.semanticPackage = semanticPackage;
        this._id = record._id || record['id'];
        delete record['id'];
        Object.assign(this, record);
        this.sourceEntity = record.peerIsSource && record.peerEntity;
        this.targetEntity = !record.peerIsSource && record.peerEntity;
    }
    get dcr() {
        return this.semanticPackage.ontology.pdcr(this.predicateName);
    }
    get id() {
        return this['_id'];
    }
    get peer() {
        return this['peerEntity'];
    }
    async getSource(...projection) {
        if (!this.sourceEntity) {
            const peerClass = this.semanticPackage.ontology.edcr(this.sourceType).clazz;
            let sCol = await this.storage.collectionForEntityType(peerClass);
            this.sourceEntity = (await sCol.findById(this.sourceId, projection));
        }
        return this.sourceEntity;
    }
    async getTarget(...projection) {
        if (!this.targetEntity) {
            const peerClass = this.semanticPackage.ontology.edcr(this.targetType).clazz;
            let peerCollection = await this.storage.collectionForEntityType(peerClass);
            this.targetEntity = (await peerCollection.findById(this.targetId, projection));
        }
        return this.targetEntity;
    }
    async change(fields) {
        let pCol = await this.semanticPackage.predicateCollection(this.dcr);
        return pCol.updateDocument(this._id, fields, this._version);
    }
    erase() {
        return this.semanticPackage.deletePredicate(this);
    }
}
exports.Predicate = Predicate;
async function idAndType2entity(id, type) {
    const eDcr = this.getOntology().edcr(type);
    if (!eDcr)
        throw new logged_exception_1.LoggedException(`Entity type ${type} isn't part of the system's ontology`);
    const entityClass = eDcr.clazz;
    return entityClass['createFromDB'](entityClass, id);
}
exports.idAndType2entity = idAndType2entity;
//# sourceMappingURL=model-manager.js.map