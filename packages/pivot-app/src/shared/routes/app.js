import {
    ref as $ref,
    atom as $atom,
    pathValue as $pathValue,
    pathInvalidation as $invalidation
} from 'falcor-json-graph';

import { getHandler,
         mapObjectsToAtoms,
         captureErrorStacks } from './support';

export function app({ loadApp, calcTotals, insertPivot, spliceRow, searchPivot, uploadGraph }) {

    const appGetRoute = getHandler([], loadApp);

    return [{
        returns: `*`,
        get: appGetRoute,
        route: `['id', 'url', 'title', 'total', 'urls', 'urlIndex']`
    }, {
        get: appGetRoute,
        returns: 'String',
        route: `['cols'].id`
    }, {
        returns: `Number`,
        route: `['cols', 'pivots'].length`,
        get: listLengthGetRoute({ loadApp })
    }, {
        route: `['cols'][{ranges}]`,
        get: rangesToListItemsGetRoute({ loadApp }),
        returns: `String`
    }, {
        route: `['pivots'][{ranges}]`,
        get: rangesToListItemsGetRoute({ loadApp }),
        returns: `$ref('pivotsById[{ rowId }]')`
    }, {
        route: `pivots.insert`,
        call: insertRowCallRoute({ loadApp, calcTotals, insertPivot, searchPivot })
    }, {
        route: `pivots.splice`,
        call: spliceRowCallRoute({ loadApp, calcTotals, spliceRow, searchPivot, uploadGraph })
    }, {
        route: `pivots.searchPivot`,
        call: searchPivotCallRoute({ loadApp, calcTotals, spliceRow, searchPivot, uploadGraph })
    }];
}

function listLengthGetRoute({ loadApp }) {
    return function getRowsLength(path) {

        // The Array of list names (either `cols` or `rows`) from which to
        // retrieve each range.
        const listNames = [].concat(path[0]);

        return loadApp().mergeMap(
            (app) => listNames,
            (app, listName) => $pathValue(
                `${listName}.length`, app[listName].length
            )
        );
    }
}

function rangesToListItemsGetRoute({ loadApp }) {
    return function rangesToListItems(path) {

        // The Array of list names (either `cols` or `rows`) from which to
        // retrieve each range.
        const listNames = [].concat(path[0])

        // An Array of Ranges ([{ from: int, to: int }, ...])
        //
        // A Range is a more compact way to represent an Array of consecutive
        // integers. Since Falcor communicates via JSON, Ranges are an
        // optimization to reduce transport size.
        // For example:
        // [0, 1, 2, 3 (,) ... 999, 1000] yields { from: 0, to: 1000 }
        //
        // Since non-consecutive integers can be requested, Falcor collapses
        // integer requests into an Array of Ranges, where each Range is a
        // consecutive integer list.
        // For example,
        // [0, 1, 2, 10, 11, 12] yields [{from: 0, to:2}, {from:10, to:12}]
        const ranges = [].concat(path[1]);

        // Convert the Ranges to an Array of integers
        const indexes = ranges.reduce(
            (indexes, { from, to }) => {
                return indexes.concat(
                    // Array.from({ length: <int> }, (e, i) => int) is a
                    // convenient and native way to create an Array from
                    // a range. Calculate offset with the range's `from`
                    // as an offset.
                    Array.from(
                        { length: to - from + 1 },
                        (x, index) => index + from
                    )
                );
        }, []);

        return loadApp()
            // enumerate each list from the app state ...
            .mergeMap(
                (app) => listNames,
                // Create an intermediate Object that preserves
                // both the list name and the list value.
                (app, name) => ({
                    name, list: app[name]
                })
            )
            // then enumerate each element from each list,
            // but don't enumerate indexes that aren't in the list.
            .mergeMap(
                ({ name, list }) => indexes.filter((index) => (
                    index < list.length
                )),
                ({ name, list }, index) => {
                    return $pathValue(` ${name}[${index}]`, list[index])
                }
            );
    }
}

function insertRowCallRoute({ loadApp, calcTotals, insertPivot }) {
    return function insertRowCall(path, args) {
        console.log("Insert row called");
        const [id] = args;
        return loadApp().mergeMap(
            (app) => insertPivot({ app, id }),
            (app, { pivot, index }) => ({
                app, pivot, index
            })
        )
        .mergeMap(({ app, pivot, index }) => {
            const { pivots } = app;
            const { length } = pivots;
            const values = [
                $pathValue(`total`, app.total),
                $pathValue(`pivots.length`, length),
                $pathValue(`pivots[${index}]`, pivots[index]),
                $pathValue(`urlIndex`, app.urlIndex),
            ];
            $invalidation('urlIndex')

            if (index < length - 1) {
                values.push($invalidation(`pivots[${index + 1}..${length - 1}]`));
            }

            return values;
        })
        .map(mapObjectsToAtoms)
        .catch(captureErrorStacks);
    }
}

function searchPivotCallRoute({ loadApp, calcTotals, insertRow, searchPivot, uploadGraph }) {
    return function searchPivotCall(path, args) {
        const [id] = args;
        return loadApp().mergeMap(
            (app) => searchPivot({ app, id }),
        )
        .mergeMap(
            ({app, index}) => uploadGraph(app),
            ({app, index}, name) => ({
                app, index, name
            })
        ) 
        //.do(({app, index, name}) => console.log("Done uploading graph", name, "index", index))
        .mergeMap(({ app, index, name }) => {
            app.url = 'https://labs.graphistry.com/graph/graph.html?type=vgraph&dataset=' + name;
            const { pivots } = app;
            const { length } = pivots;
            const values = [
                $pathValue(`pivots[${index}].enabled`, pivots[index].enabled),
                $pathValue(`pivots[${index}].resultCount`, pivots[index].resultCount),
                $pathValue('url', app.url),
            ];

            return values;
        })
        .map(mapObjectsToAtoms)
        .catch(captureErrorStacks);
    }
}

function spliceRowCallRoute({ loadApp, calcTotals, spliceRow, uploadGraph }) {
    return function spliceRowCall(path, args) {
        const [id] = args;
        return loadApp().mergeMap(
            (app) => spliceRow({ app, id }),
            (app, { row, index }) => ({
                app, row, index
            })
        )
        .mergeMap(
            ({app}) => uploadGraph(app),
             ({app, row, index}, name) => ({
                 app, row, index, name
             })
        )
        .mergeMap(({ app, row, index, name }) => {
            app.url = 'https://labs.graphistry.com/graph/graph.html?type=vgraph&dataset=' + name;
            const { rows } = app;
            const { length } = rows;
            const values = [
                $pathValue(`total`, app.total),
                $pathValue(`pivots.length`, length),
                $pathValue('url', app.url),
                $invalidation(`pivotsById['${row.id}']`),
                $invalidation(`pivots[${index}..${length}]`),
            ];

            return values;
        })
        .map(mapObjectsToAtoms)
        .catch(captureErrorStacks);
    }
}
