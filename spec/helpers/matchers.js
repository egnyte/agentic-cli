// Custom Jasmine matchers — identical pattern to egnyte-js-sdk.

beforeEach(function() {
    jasmine.addMatchers({
        // Fail the spec with the error detail — used in .catch(e => expect(this).toAutoFail(e))
        toAutoFail: function() {
            return {
                compare: function(nothing, error) {
                    return {
                        pass:    false,
                        message: (error.statusCode ? "[ HTTP" + error.statusCode + " ]" : "[ JS ]") + " " + error,
                    };
                },
            };
        },
        // Assert stdout is valid JSON
        toBeValidJSON: function() {
            return {
                compare: function(actual) {
                    try {
                        JSON.parse(actual);
                        return { pass: true };
                    } catch (e) {
                        return { pass: false, message: "Expected stdout to be valid JSON but got: " + actual };
                    }
                },
            };
        },
    });
});
