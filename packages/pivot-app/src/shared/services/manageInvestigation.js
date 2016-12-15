import { Observable } from 'rxjs';
import _ from 'underscore';
import { ref as $ref } from '@graphistry/falcor-json-graph';
import {
    createInvestigationModel,
    createPivotModel,
    cloneInvestigationModel,
    clonePivotModel
} from '../models';
import logger from '../logger.js';
const log = logger.createLogger('pivot-app', __filename);


function insertAndSelectInvestigation(app, user, newInvestigation) {
    app.investigationsById[newInvestigation.id] = newInvestigation;
    const newRef = $ref(`investigationsById['${newInvestigation.id}']`);
    user.investigations.push(newRef);
    user.activeInvestigation = newRef;

    return user.investigations.length;
}

function insertPivots(app, pivots) {
    pivots.forEach(pivot => {
        app.pivotsById[pivot.id] = pivot;
    });
}

function getActiveInvestigationId(user) {
    return user.activeInvestigation !== undefined ? user.activeInvestigation.value[1]
                                                  : undefined;
}

export function createInvestigation({ loadUsersById, userIds }) {
    return loadUsersById({userIds})
        .map(({app, user}) => {
            const pivot0 = createPivotModel({});
            const newInvestigation = createInvestigationModel({pivots: [pivot0.id]}, user.investigations.length);
            insertPivots(app, [pivot0]);
            const numInvestigations = insertAndSelectInvestigation(app, user, newInvestigation);

            return ({app, user, newInvestigation, numInvestigations});
        })
        .do(({newInvestigation}) =>
            log.debug(`Created new investigation ${newInvestigation.id}`)
        );
}

export function switchActiveInvestigation({ loadUsersById, loadInvestigationsById,
                                            unloadInvestigationsById, unloadPivotsById,
                                            userId }) {
    return loadUsersById({userIds: [userId]})
        .mergeMap(({app, user}) => {
            const activeId = getActiveInvestigationId(user)
            if (activeId === undefined) {
                return Observable.of(null);
            }
            return closeInvestigationsById({ loadInvestigationsById, unloadInvestigationsById,
                                             unloadPivotsById, investigationIds: [activeId] })
        });
}

function closeInvestigationsById({ loadInvestigationsById, unloadInvestigationsById,
                                   unloadPivotsById, investigationIds }) {
    return loadInvestigationsById({investigationIds})
        .mergeMap(({app, investigation}) => {
            const pivotIds = investigation.pivots.map(x => x.value[1]);

            return unloadPivotsById({pivotIds});
        })
        .toArray()
        .switchMap(() =>
            unloadInvestigationsById({investigationIds})
        )
        .do(({investigation}) =>
            log.info(`Closed investigation ${investigation.id}`)
        );
}

export function cloneInvestigationsById({ loadInvestigationsById, loadPivotsById, loadUsersById,
                                          investigationIds }) {
    return loadInvestigationsById({investigationIds})
        .mergeMap(({app, investigation}) =>
            Observable.combineLatest(
                loadPivotsById({pivotIds: investigation.pivots.map(x => x.value[1])})
                    .map(({pivot}) => clonePivotModel(pivot))
                    .toArray(),
                loadUsersById({userIds: [app.currentUser.value[1]]}),
                (clonedPivots, {user}) => ({clonedPivots, user})
            )
            .map(({clonedPivots, user}) => {
                insertPivots(app, clonedPivots);
                const clonedInvestigation = cloneInvestigationModel(investigation, clonedPivots);
                const numInvestigations = insertAndSelectInvestigation(app, user, clonedInvestigation);

                return {
                    app,
                    user,
                    clonedInvestigation,
                    originalInvestigation: investigation,
                    numInvestigations,
                };
            })
        )
        .do(({originalInvestigation, clonedInvestigation}) =>
            log.debug(`Cloned investigation ${originalInvestigation.id} to ${clonedInvestigation.id}`)
        );
}

export function saveInvestigationsById({loadInvestigationsById, persistInvestigationsById,
                                        persistPivotsById, unlinkPivotsById, investigationIds}) {
    return loadInvestigationsById({investigationIds})
        .mergeMap(({app, investigation}) => {
            investigation.modifiedOn = Date.now();
            const pivotIds = investigation.pivots.map(x => x.value[1]);

            return persistPivotsById({pivotIds})
                .toArray()
                .switchMap(() =>
                    unlinkPivotsById({pivotIds: investigation.detachedPivots})
                        .toArray()
                )
                .switchMap(() =>
                    persistInvestigationsById({investigationIds: [investigation.id]})
                )
                .map(() => ({app, investigation}));
        })
        .do(({investigation}) =>
            log.debug(`Saved investigation ${investigation.id}`)
        );
}

export function removeInvestigationsById({loadUsersById, unlinkInvestigationsById, unlinkPivotsById,
                                          investigationIds, userIds}) {
    return loadUsersById({userIds: userIds})
        .mergeMap(({user, app}) => {
            const newInvestigations = _.reject(user.investigations, i =>
                investigationIds.includes(i.value[1])
            );
            const oldLength = user.investigations.length;
            user.investigations = newInvestigations;

            const activeInvestigationId = getActiveInvestigationId(user);
            if (investigationIds.includes(activeInvestigationId)) {
                user.activeInvestigation  = newInvestigations.length > 0 ?
                                            user.investigations[0] :
                                            undefined;
            }

            return unlinkInvestigationsById({investigationIds})
                .mergeMap(
                    ({app, investigation}) => {
                        const pivotIds = investigation.pivots.map(x => x.value[1]);

                        return unlinkPivotsById({pivotIds})
                            .toArray();
                    },
                    ({app,  investigation}) => ({
                        app,
                        user,
                        investigation,
                        oldLength,
                        newLength: newInvestigations.length
                    })
                )
                .do(({investigation}) =>
                    log.debug(`Removed investigation ${investigation.id}`)
                );
        });
}
