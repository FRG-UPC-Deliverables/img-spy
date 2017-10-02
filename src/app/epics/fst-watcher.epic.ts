import { Observable }               from "rxjs";
import { Action }                   from "redux-actions";
import { actions as formActions }   from "react-redux-form";
import { combineEpics }             from "redux-observable";
import { ImgFile }                  from "tsk-js";

import { AnalysisInfo }             from "main/models";

import { actions }                  from "app/constants";
import { ApiObservable }            from "app/api";
import { EpicObservable,
         ActionObservable,
         ActionObserver,
         FstItem,
         FstAddPayload,
         FstUnlinkPayload,
         FstHashPayload,
         getFstType,
         getFstItem,
         getMountPoint,
         hasFstItem,
         FstDataSource,
         FstDirectory,
         DataSource,
         ImgSpyState }              from "app/models";
import { fstAdd,
         fstHash,
         deleteSource,
         updateSource,
         applySettings,
         pushTerminalLine }         from "app/actions";


const dataSourceChange$ =
    (action$: EpicObservable<FstAddPayload>, store): Observable<FstDataSource> =>
        action$.ofType(actions.FST_ADD)
            .filter(action => {
                return action.payload.newItem.type === "dataSource";
            })
            .map(action => {
                const state: ImgSpyState = store.getState();
                return getFstItem(state.fstRoot, action.payload.newItem.path) as FstDataSource;
            });


const launchCalcHashEpic = (action$: EpicObservable<FstAddPayload>, store) =>
    dataSourceChange$(action$, store)
        .filter(dataSource => !dataSource.computedHash && !dataSource.computingHash)
        .flatMap(dataSource => [
            pushTerminalLine({ level: "notice", text: `Analyzing image '${dataSource.path}'...`}),
            fstHash(dataSource)
        ]);


const calcHashEpic = (action$: EpicObservable<FstDataSource>, store) =>
    action$.ofType(actions.FST_HASH)
        .mergeMap(action => {
            const { path } = action.payload;
            return ApiObservable
                .create<AnalysisInfo>((api, cb) => api.analyzeImage(path, cb))
                .map((info) => ({
                    type: "dataSource",
                    path,
                    computedHash: info.hash,
                    imgType: info.type,
                    partitions: info.partitions,
                    computingHash: false
                }) as FstDataSource);
        })
        .flatMap((fstDataSource) => {
            return [
                fstAdd(fstDataSource),
                pushTerminalLine({
                    level: "notice",
                    text: `md5(${fstDataSource.path}) = ${fstDataSource.computedHash}`
                }),
            ];
        });


const virtualMountEpic = (action$: EpicObservable<FstAddPayload>, store) =>
    dataSourceChange$(action$, store)
        .filter(dataSource => {
            const state: ImgSpyState = store.getState();
            return !state.fstRoot.children.virtual.children[dataSource.path];
        })
        .map(fstDataSource => {
            const mountPoint = getMountPoint(fstDataSource);
            let children: { [name: string]: FstItem };
            if (fstDataSource.imgType === "disk" ) {
                children = fstDataSource
                    .partitions
                    .map((partition): FstDirectory => ({
                        name: partition.description,
                        path: `${mountPoint}/${partition.description}`,
                        type: "directory",
                        address: "virtual",

                        imgPath: fstDataSource.path,
                        offset: partition.start,
                        inode: undefined,

                        isOpen: false,
                        canOpen: partition.hasFs,
                        children: {}
                    }))
                    .reduce((acc: any, child: FstItem) => {
                        acc[child.name] = child;
                        return acc;
                    }, {});
            } else {
                children = {};
            }

            const virtualDsDirectory: FstDirectory = {
                path: mountPoint,
                imgPath: fstDataSource.path,
                name: mountPoint,
                address: "virtual",

                type: "directory",
                isOpen: false,
                children
            };

            return fstAdd(virtualDsDirectory, "virtual");
        });


const virtualListEpic = (action$: EpicObservable<FstDirectory>, store) =>
    action$.ofType(actions.FST_LIST)
        .mergeMap(action => {
            const { path, imgPath, offset, inode } = action.payload;
            return ApiObservable
                .create<ImgFile[]>((api, cb) => {
                    api.listImage(imgPath, offset, inode, cb);
                })
                .map(files => ({ path, offset, imgPath, files }) );
        })
        .flatMap(acc => acc.files
            .map(file => {
                const item: any = {
                    path: `${acc.path}/${file.name}`,
                    name: file.name,

                    address: "virtual",
                    imgPath: acc.imgPath,
                    offset: acc.offset,
                    inode: file.inode,

                    type: file.type === "directory" ? "directory" : "file"
                };

                if (item.type === "directory") {
                    item.children = {};
                }

                return fstAdd(item, "virtual");
            })
        );

const copySourceIntoSettingsEpic = (action$: EpicObservable<FstAddPayload>, store) =>
    dataSourceChange$(action$, store)
        .filter((fstDataSource) => { /* Check if the file is not deleted */
            const state: ImgSpyState = store.getState();
            return hasFstItem(state.fstRoot, fstDataSource.path);
        })
        .map((fstDataSource) => updateSource({
                name: fstDataSource.name,
                path: fstDataSource.path,
                imgType: fstDataSource.imgType,

                hash: fstDataSource.hash,
                computedHash: fstDataSource.computedHash,
                partitions: fstDataSource.partitions
            })
        );


const removeFileEpic = (action$: EpicObservable<FstUnlinkPayload>, store) =>
    action$.ofType(actions.FST_UNLINK)
        .filter((action) => {
            const state: ImgSpyState = store.getState();
            const dataSource = state.settings.sources[action.payload.path];
            return !!dataSource;
        })
        .map((action) => deleteSource(action.payload.path));


export default () =>
    (combineEpics as any)(
        launchCalcHashEpic,
        removeFileEpic,
        virtualMountEpic,
        virtualListEpic,
        calcHashEpic,
        copySourceIntoSettingsEpic
    );
