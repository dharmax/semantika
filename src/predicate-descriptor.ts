export class PredicateDcr {
    parent?: PredicateDcr | string;

    constructor(public readonly name: string, public children: PredicateDcr[] = [],
                public readonly keys: { source?: string[], target?: string[], self?: string[] } = {
                    source: [],
                    target: [],
                    self: []
                }, public rules?: any) {
    }

    setParent(pDcrName: string) {
        this.parent = pDcrName
        return this
    }

}