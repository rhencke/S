/// <reference path="../S.d.ts" />
(function () {
    "use strict";
    // Public interface
    var S = function S(fn, seed) {
        var parent = Updating, sampling = Sampling, options = (this instanceof Options ? this : null), hold = options && options._defer ? defer(options._defer) : parent ? parent.hold : null, orphan = options && options._orphan, node = new ComputationNode(fn, seed, hold);
        Updating = node;
        Sampling = false;
        if (Batching) {
            node.value = node.fn(node.value);
        }
        else {
            Batching = true;
            Changes.reset();
            toplevelComputation(node);
        }
        if (parent && !orphan)
            (parent.children || (parent.children = [])).push(node);
        Updating = parent;
        Sampling = sampling;
        return function computation() {
            if (Disposing) {
                if (Updating)
                    Disposes.add(node);
                else
                    dispose(node);
            }
            else if (Updating) {
                if (node.age === Time) {
                    if (node.state === UPDATING)
                        throw new Error("circular dependency");
                    else
                        update(node);
                }
                if (!Sampling)
                    logComputationRead(node, Updating);
            }
            return node.value;
        };
    };
    S.on = function on(ev, fn, seed, onchanges) {
        if (Array.isArray(ev))
            ev = callAll(ev);
        onchanges = !!onchanges;
        return this instanceof Options ? this.S(on, seed) : S(on, seed);
        function on(value) {
            ev();
            if (onchanges)
                onchanges = false;
            else {
                Sampling = true;
                value = fn(value);
                Sampling = false;
            }
            return value;
        }
    };
    /// Fluent-style options
    var Options = (function () {
        function Options(prev, _orphan, _defer) {
            this._orphan = _orphan;
            this._defer = _defer;
            this._defer = _defer || prev && prev._defer;
            this._orphan = _orphan || prev && prev._orphan;
        }
        Options.prototype.defer = function (scheduler) {
            return new Options(this, false, scheduler);
        };
        return Options;
    }());
    Options.prototype.S = S;
    Options.prototype.on = S.on;
    var _orphan = new Options(null, true, null);
    S.orphan = function orphan() {
        return _orphan;
    };
    S.defer = function (fn) {
        return new Options(null, false, fn);
    };
    function defer(scheduler) {
        var gotime = 0, root = new DataNode(null), tick = scheduler(go);
        return function hold() {
            if (Time === gotime)
                return false;
            if (tick)
                tick();
            logDataRead(root, this);
            return true;
        };
        function go() {
            gotime = Time + 1;
            if (Batching)
                Changes.add(root);
            else
                event(root);
        }
    }
    function callAll(ss) {
        return function all() {
            for (var i = 0; i < ss.length; i++)
                ss[i]();
        };
    }
    S.data = function data(value) {
        var node = new DataNode(value);
        return function data(value) {
            if (arguments.length > 0) {
                if (Batching) {
                    if (node.pending !== NOTPENDING) {
                        if (value !== node.pending) {
                            throw new Error("conflicting changes: " + value + " !== " + node.pending);
                        }
                    }
                    else {
                        node.pending = value;
                        Changes.add(node);
                    }
                }
                else {
                    if (node.log) {
                        node.pending = value;
                        event(node);
                    }
                    else {
                        node.value = value;
                    }
                }
                return value;
            }
            else {
                if (Updating && !Sampling)
                    logDataRead(node, Updating);
                return node.value;
            }
        };
    };
    S.value = function value(current, eq) {
        var data = S.data(current), age = 0;
        return function value(update) {
            if (arguments.length === 0) {
                return data();
            }
            else {
                var same = eq ? eq(current, update) : current === update;
                if (!same) {
                    if (age === Time)
                        throw new Error("conflicting values: " + value + " is not the same as " + current);
                    age = Time;
                    current = update;
                    data(update);
                }
                return update;
            }
        };
    };
    S.sum = function sum(value) {
        var node = new DataNode(value);
        return function sum(update) {
            if (arguments.length > 0) {
                if (Batching) {
                    if (node.pending !== NOTPENDING) {
                        node.pending = update(node.pending);
                    }
                    else {
                        node.pending = update(node.value);
                        Changes.add(node);
                    }
                }
                else {
                    if (node.log) {
                        node.pending = update(node.value);
                        event(node);
                    }
                    else {
                        node.value = update(node.value);
                    }
                }
                return value;
            }
            else {
                if (Updating && !Sampling)
                    logDataRead(node, Updating);
                return node.value;
            }
        };
    };
    S.freeze = function freeze(fn) {
        var result;
        if (Batching) {
            result = fn();
        }
        else {
            Batching = true;
            Changes.reset();
            try {
                result = fn();
                event(null);
            }
            finally {
                Batching = false;
            }
        }
        return result;
    };
    S.sample = function sample(fn) {
        var result;
        if (Updating && !Sampling) {
            Sampling = true;
            result = fn();
            Sampling = false;
        }
        else {
            result = fn();
        }
        return result;
    };
    S.dispose = function dispose(signal) {
        if (Disposing) {
            signal();
        }
        else {
            Disposing = true;
            try {
                signal();
            }
            finally {
                Disposing = false;
            }
        }
    };
    S.cleanup = function cleanup(fn) {
        if (Updating) {
            (Updating.cleanups || (Updating.cleanups = [])).push(fn);
        }
        else {
            throw new Error("S.cleanup() must be called from within an S() computation.  Cannot call it at toplevel.");
        }
    };
    // Internal implementation
    /// Graph classes and operations
    var DataNode = (function () {
        function DataNode(value) {
            this.value = value;
            this.pending = NOTPENDING;
            this.log = null;
        }
        return DataNode;
    }());
    var ComputationNode = (function () {
        function ComputationNode(fn, value, hold) {
            this.fn = fn;
            this.value = value;
            this.hold = hold;
            this.id = ComputationNode.count++;
            this.age = Time;
            this.state = CURRENT;
            this.count = 0;
            this.sources = [];
            this.log = null;
            this.children = null;
            this.cleanups = null;
        }
        ComputationNode.count = 0;
        return ComputationNode;
    }());
    var Log = (function () {
        function Log() {
            this.count = 0;
            this.nodes = [];
            this.ids = [];
        }
        return Log;
    }());
    var Queue = (function () {
        function Queue() {
            this.items = [];
            this.count = 0;
        }
        Queue.prototype.reset = function () {
            this.count = 0;
        };
        Queue.prototype.add = function (item) {
            this.items[this.count++] = item;
        };
        Queue.prototype.run = function (fn) {
            var items = this.items, count = this.count;
            for (var i = 0; i < count; i++) {
                fn(items[i]);
                items[i] = null;
            }
            this.count = 0;
        };
        return Queue;
    }());
    // "Globals" used to keep track of current system state
    var Time = 1, Batching = false, // whether we're batching changes
    Updating = null, // whether we're updating, null = no, non-null = node being updated
    Sampling = false, // whether we're sampling signals, with no dependencies
    Disposing = false; // whether we're disposing
    // Queues for the phases of the update process
    var Changes = new Queue(), // batched changes to data nodes
    _Changes = new Queue(), // alternate array of batched changes to data nodes
    Updates = new Queue(), // computations to update
    Disposes = new Queue(); // disposals to run after current batch of updates finishes
    // Constants
    var REVIEWING = new ComputationNode(null, null, null), DEAD = new ComputationNode(null, null, null), NOTPENDING = {}, CURRENT = 0, STALE = 1, UPDATING = 2;
    // Functions
    function logRead(from, to) {
        var id = to.id, node = from.nodes[id];
        if (node === to)
            return; // already logged
        if (node !== REVIEWING)
            from.ids[from.count++] = id; // not in ids array
        from.nodes[id] = to;
        to.sources[to.count++] = from;
    }
    function logDataRead(data, to) {
        if (!data.log)
            data.log = new Log();
        logRead(data.log, to);
    }
    function logComputationRead(node, to) {
        if (!node.log)
            node.log = new Log();
        logRead(node.log, to);
    }
    function event(change) {
        try {
            resolve(change);
        }
        finally {
            Batching = false;
            Updating = null;
            Sampling = false;
            Disposing = false;
        }
    }
    function toplevelComputation(node) {
        try {
            node.value = node.fn(node.value);
            if (Changes.count > 0)
                resolve(null);
        }
        finally {
            Batching = false;
            Updating = null;
            Sampling = false;
            Disposing = false;
        }
    }
    function resolve(change) {
        var count = 0, changes;
        Batching = true;
        Updates.reset();
        Disposes.reset();
        if (change) {
            Changes.reset();
            Time++;
            applyDataChange(change);
            Updates.run(update);
            Disposes.run(dispose);
        }
        // for each batch ...
        while (Changes.count !== 0) {
            changes = Changes, Changes = _Changes, _Changes = changes;
            Changes.reset();
            Time++;
            changes.run(applyDataChange);
            Updates.run(update);
            Disposes.run(dispose);
            // if there are still changes after excessive batches, assume runaway            
            if (count++ > 1e5) {
                throw new Error("Runaway frames detected");
            }
        }
    }
    function applyDataChange(data) {
        data.value = data.pending;
        data.pending = NOTPENDING;
        if (data.log)
            markComputationsStale(data.log);
    }
    function markComputationsStale(log) {
        var nodes = log.nodes, ids = log.ids, dead = 0;
        for (var i = 0; i < log.count; i++) {
            var id = ids[i], node = nodes[id];
            if (node === REVIEWING) {
                nodes[id] = DEAD;
                dead++;
            }
            else {
                if (node.age < Time) {
                    node.age = Time;
                    if (!node.hold || !node.hold()) {
                        node.state = STALE;
                        Updates.add(node);
                        if (node.children)
                            markChildrenForDisposal(node.children);
                        if (node.log)
                            markComputationsStale(node.log);
                    }
                    else {
                        node.state = CURRENT;
                    }
                }
                if (dead)
                    ids[i - dead] = id;
            }
        }
        if (dead)
            log.count -= dead;
    }
    function markChildrenForDisposal(children) {
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            child.age = Time;
            child.state = CURRENT;
            if (child.children)
                markChildrenForDisposal(child.children);
        }
    }
    function update(node) {
        if (node.state === STALE) {
            var updating = Updating, sampling = Sampling;
            Updating = node;
            Sampling = false;
            node.state = UPDATING;
            cleanup(node, false);
            node.value = node.fn(node.value);
            node.state = CURRENT;
            Updating = updating;
            Sampling = sampling;
        }
    }
    function cleanup(node, final) {
        var sources = node.sources, cleanups = node.cleanups, children = node.children;
        if (cleanups) {
            for (var i = 0; i < cleanups.length; i++) {
                cleanups[i](final);
            }
            node.cleanups = null;
        }
        if (children) {
            for (var i = 0; i < children.length; i++) {
                dispose(children[i]);
            }
            node.children = null;
        }
        for (var i = 0; i < node.count; i++) {
            sources[i].nodes[node.id] = REVIEWING;
            sources[i] = null;
        }
        node.count = 0;
    }
    function dispose(node) {
        node.fn = null;
        node.hold = null;
        node.log = null;
        cleanup(node, true);
        node.sources = null;
    }
    // UMD exporter
    /* globals define */
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = S; // CommonJS
    }
    else if (typeof define === 'function') {
        define([], function () { return S; }); // AMD
    }
    else {
        (eval || function () { })("this").S = S; // fallback to global object
    }
})();
