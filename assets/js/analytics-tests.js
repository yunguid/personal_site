/**
 * Analytics Dashboard Test Suite
 *
 * Run these tests in the browser console on the analytics.html page
 * to verify input validation and functionality.
 *
 * Usage: Copy and paste into browser console, or include in page with:
 * <script src="assets/js/analytics-tests.js"></script>
 * Then run: AnalyticsTests.runAll();
 */

const AnalyticsTests = {
    results: [],
    passed: 0,
    failed: 0,

    // Test runner
    test: function(name, fn) {
        try {
            const result = fn();
            if (result === true) {
                this.passed++;
                this.results.push({ name, status: 'PASS', message: '' });
                console.log(`✅ PASS: ${name}`);
            } else {
                this.failed++;
                this.results.push({ name, status: 'FAIL', message: result || 'Assertion failed' });
                console.log(`❌ FAIL: ${name} - ${result}`);
            }
        } catch (error) {
            this.failed++;
            this.results.push({ name, status: 'ERROR', message: error.message });
            console.log(`💥 ERROR: ${name} - ${error.message}`);
        }
    },

    // Reset test state
    reset: function() {
        this.results = [];
        this.passed = 0;
        this.failed = 0;
    },

    // Run all tests
    runAll: function() {
        this.reset();
        console.log('🧪 Running Analytics Dashboard Tests...\n');

        // Validator tests
        this.runValidatorTests();

        // UI tests
        this.runUITests();

        // Data tests
        this.runDataTests();

        // Print summary
        console.log('\n' + '='.repeat(50));
        console.log(`📊 Test Results: ${this.passed} passed, ${this.failed} failed`);
        console.log('='.repeat(50));

        return {
            passed: this.passed,
            failed: this.failed,
            results: this.results
        };
    },

    // Validator Tests
    runValidatorTests: function() {
        console.log('\n📋 Validator Tests:');

        // Test isValidDate
        this.test('isValidDate: Valid date string', () => {
            return Validator.isValidDate('2024-01-15') === true;
        });

        this.test('isValidDate: Invalid date string', () => {
            return Validator.isValidDate('invalid-date') === false;
        });

        this.test('isValidDate: Empty string', () => {
            return Validator.isValidDate('') === false;
        });

        this.test('isValidDate: Null value', () => {
            return Validator.isValidDate(null) === false;
        });

        this.test('isValidDate: Undefined value', () => {
            return Validator.isValidDate(undefined) === false;
        });

        // Test isValidDateRange
        this.test('isValidDateRange: Valid range', () => {
            const result = Validator.isValidDateRange('2024-01-01', '2024-01-31');
            return result.valid === true;
        });

        this.test('isValidDateRange: End before start', () => {
            const result = Validator.isValidDateRange('2024-01-31', '2024-01-01');
            return result.valid === false && result.error === 'Start date must be before end date';
        });

        this.test('isValidDateRange: Range exceeds 1 year', () => {
            const result = Validator.isValidDateRange('2023-01-01', '2024-12-31');
            return result.valid === false && result.error === 'Date range cannot exceed 1 year';
        });

        this.test('isValidDateRange: Invalid start date', () => {
            const result = Validator.isValidDateRange('invalid', '2024-01-31');
            return result.valid === false;
        });

        // Test sanitizeString
        this.test('sanitizeString: Removes HTML tags', () => {
            return Validator.sanitizeString('<script>alert("xss")</script>') === 'scriptalert("xss")/script';
        });

        this.test('sanitizeString: Trims whitespace', () => {
            return Validator.sanitizeString('  hello world  ') === 'hello world';
        });

        this.test('sanitizeString: Handles non-string input', () => {
            return Validator.sanitizeString(123) === '';
        });

        this.test('sanitizeString: Handles null input', () => {
            return Validator.sanitizeString(null) === '';
        });

        // Test isValidPeriod
        this.test('isValidPeriod: Valid period "day"', () => {
            return Validator.isValidPeriod('day') === true;
        });

        this.test('isValidPeriod: Valid period "week"', () => {
            return Validator.isValidPeriod('week') === true;
        });

        this.test('isValidPeriod: Valid period "month"', () => {
            return Validator.isValidPeriod('month') === true;
        });

        this.test('isValidPeriod: Valid period "year"', () => {
            return Validator.isValidPeriod('year') === true;
        });

        this.test('isValidPeriod: Invalid period', () => {
            return Validator.isValidPeriod('decade') === false;
        });

        this.test('isValidPeriod: Empty string', () => {
            return Validator.isValidPeriod('') === false;
        });
    },

    // UI Tests
    runUITests: function() {
        console.log('\n🖥️ UI Tests:');

        this.test('Map container exists', () => {
            return document.getElementById('map') !== null;
        });

        this.test('Stats grid exists', () => {
            return document.querySelector('.stats-grid') !== null;
        });

        this.test('Time filter buttons exist', () => {
            const buttons = document.querySelectorAll('.time-filter button');
            return buttons.length === 4;
        });

        this.test('Active time filter button is set', () => {
            const activeButton = document.querySelector('.time-filter button.active');
            return activeButton !== null;
        });

        this.test('Traffic chart canvas exists', () => {
            return document.getElementById('trafficChart') !== null;
        });

        this.test('Device chart canvas exists', () => {
            return document.getElementById('deviceChart') !== null;
        });

        this.test('Sources chart canvas exists', () => {
            return document.getElementById('sourcesChart') !== null;
        });

        this.test('Heatmap grid exists', () => {
            return document.getElementById('heatmapGrid') !== null;
        });

        this.test('Heatmap has cells', () => {
            const cells = document.querySelectorAll('.heatmap-cell');
            return cells.length === 168; // 7 days * 24 hours
        });

        this.test('Top countries container exists', () => {
            return document.getElementById('topCountries') !== null;
        });

        this.test('Top pages container exists', () => {
            return document.getElementById('topPages') !== null;
        });

        this.test('Date pickers exist', () => {
            const startDate = document.getElementById('startDate');
            const endDate = document.getElementById('endDate');
            return startDate !== null && endDate !== null;
        });

        this.test('Refresh button exists', () => {
            return document.getElementById('refreshBtn') !== null;
        });

        this.test('Back link exists', () => {
            const backLink = document.querySelector('.back-link');
            return backLink !== null && backLink.href.includes('index.html');
        });
    },

    // Data Tests
    runDataTests: function() {
        console.log('\n📊 Data Tests:');

        this.test('AnalyticsData object exists', () => {
            return typeof AnalyticsData === 'object';
        });

        this.test('AnalyticsData.getData returns data for "day"', () => {
            const data = AnalyticsData.getData('day');
            return data && typeof data.views === 'number' && typeof data.visitors === 'number';
        });

        this.test('AnalyticsData.getData returns data for "week"', () => {
            const data = AnalyticsData.getData('week');
            return data && typeof data.views === 'number' && typeof data.visitors === 'number';
        });

        this.test('AnalyticsData.getData returns data for "month"', () => {
            const data = AnalyticsData.getData('month');
            return data && typeof data.views === 'number' && typeof data.visitors === 'number';
        });

        this.test('AnalyticsData.getData returns data for "year"', () => {
            const data = AnalyticsData.getData('year');
            return data && typeof data.views === 'number' && typeof data.visitors === 'number';
        });

        this.test('AnalyticsData.getCountryData returns array', () => {
            const countries = AnalyticsData.getCountryData();
            return Array.isArray(countries) && countries.length > 0;
        });

        this.test('Country data has required fields', () => {
            const countries = AnalyticsData.getCountryData();
            const country = countries[0];
            return country.name && country.flag && typeof country.views === 'number' && typeof country.percentage === 'number';
        });

        this.test('AnalyticsData.getLocationData returns array', () => {
            const locations = AnalyticsData.getLocationData();
            return Array.isArray(locations) && locations.length > 0;
        });

        this.test('Location data has required fields', () => {
            const locations = AnalyticsData.getLocationData();
            const location = locations[0];
            return typeof location.lat === 'number' && typeof location.lng === 'number' && location.city && typeof location.count === 'number';
        });

        this.test('AnalyticsData.getTrafficData returns labels and data', () => {
            const traffic = AnalyticsData.getTrafficData('week');
            return Array.isArray(traffic.labels) && Array.isArray(traffic.views) && Array.isArray(traffic.visitors);
        });

        this.test('AnalyticsData.getDeviceData returns array', () => {
            const devices = AnalyticsData.getDeviceData();
            return Array.isArray(devices) && devices.length > 0;
        });

        this.test('Device data percentages sum to 100', () => {
            const devices = AnalyticsData.getDeviceData();
            const sum = devices.reduce((acc, d) => acc + d.value, 0);
            return sum === 100;
        });

        this.test('AnalyticsData.getTopPages returns array', () => {
            const pages = AnalyticsData.getTopPages();
            return Array.isArray(pages) && pages.length > 0;
        });

        this.test('AnalyticsData.getSourcesData returns labels and data', () => {
            const sources = AnalyticsData.getSourcesData();
            return Array.isArray(sources.labels) && Array.isArray(sources.data);
        });

        this.test('AnalyticsData.getHeatmapData returns 168 items', () => {
            const heatmap = AnalyticsData.getHeatmapData();
            return Array.isArray(heatmap) && heatmap.length === 168;
        });

        this.test('Heatmap data has valid intensity values', () => {
            const heatmap = AnalyticsData.getHeatmapData();
            return heatmap.every(item => item.value >= 0 && item.value <= 1);
        });
    },

    // Interactive tests (run manually)
    runInteractiveTests: function() {
        console.log('\n🔧 Interactive Tests (manual verification required):');

        console.log('1. Click on time filter buttons and verify data updates');
        console.log('2. Change date range and verify validation messages');
        console.log('3. Click refresh button and verify loading state');
        console.log('4. Hover over map markers and verify popups');
        console.log('5. Hover over heatmap cells and verify tooltips');
        console.log('6. Verify responsive layout on different screen sizes');
        console.log('7. Verify chart tooltips on hover');
    }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnalyticsTests;
}

// Auto-run hint
console.log('📋 Analytics Tests loaded. Run AnalyticsTests.runAll() to execute tests.');
