import {SemanticPackage} from "./semantic-package";

export abstract class SemanticArtifact {
    private readonly _semanticPackageName: string

    id
    protected constructor(sp: SemanticPackage, public _id) {
        this._semanticPackageName = sp.name
        this.id = _id
    }

    get semanticPackage(): SemanticPackage {
        return SemanticPackage.findSemanticPackage(this._semanticPackageName)
    }
}