import { type AbstractMesh } from "core/Meshes/abstractMesh";
import { type IBoundingInfoHelperPlatform } from "./IBoundingInfoHelperPlatform";
import { type Mesh } from "core/Meshes/mesh";
import { VertexBuffer } from "core/Buffers/buffer";
import { type Vector3 } from "core/Maths/math.vector";

type BoundingExtents = {
    minimum: Vector3;
    maximum: Vector3;
};

/**
 * CPU fallback for compute-capable engines that cannot read storage buffers back.
 * @internal
 */
export class CpuBoundingInfoHelper implements IBoundingInfoHelperPlatform {
    private _processedMeshes: AbstractMesh[] = [];
    private _results = new Map<AbstractMesh, BoundingExtents>();

    /** @internal */
    public async processAsync(meshes: AbstractMesh | AbstractMesh[]): Promise<void> {
        await this.registerMeshListAsync(meshes);
        this.processMeshList();
        await this.fetchResultsForMeshListAsync();
    }

    /** @internal */
    public registerMeshListAsync(meshes: AbstractMesh | AbstractMesh[]): Promise<void> {
        this._processedMeshes = [];
        this._results.clear();

        const meshList = Array.isArray(meshes) ? meshes : [meshes];
        for (const mesh of meshList) {
            const vertexCount = mesh.getTotalVertices();
            if (vertexCount === 0 || !(mesh as Mesh).getVertexBuffer?.(VertexBuffer.PositionKind)) {
                continue;
            }
            this._processedMeshes.push(mesh);
        }

        return Promise.resolve();
    }

    /** @internal */
    public processMeshList(): void {
        for (const mesh of this._processedMeshes) {
            const previous = {
                minimum: mesh.getBoundingInfo().minimum.clone(),
                maximum: mesh.getBoundingInfo().maximum.clone(),
            };

            mesh.refreshBoundingInfo(true, true);
            const current = mesh.getBoundingInfo();
            const result = this._results.get(mesh);

            if (result) {
                result.minimum.minimizeInPlace(current.minimum);
                result.maximum.maximizeInPlace(current.maximum);
            } else {
                this._results.set(mesh, {
                    minimum: current.minimum.clone(),
                    maximum: current.maximum.clone(),
                });
            }

            mesh._refreshBoundingInfoDirect(previous);
        }
    }

    /** @internal */
    public fetchResultsForMeshListAsync(): Promise<void> {
        for (const [mesh, result] of this._results) {
            mesh._refreshBoundingInfoDirect(result);
        }
        this._results.clear();
        return Promise.resolve();
    }

    /** @internal */
    public dispose(): void {
        this._processedMeshes = [];
        this._results.clear();
    }
}
