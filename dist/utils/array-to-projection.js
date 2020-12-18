"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.arrayToProjection = void 0;
function arrayToProjection(projection, cursor) {
    projection = Array.from(new Set(projection));
    let p = projection.reduce((res, cur) => {
        cur && (res[cur] = 1);
        return res;
    }, {});
    cursor.project(p);
}
exports.arrayToProjection = arrayToProjection;
//# sourceMappingURL=array-to-projection.js.map