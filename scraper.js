// This script is designed to be run in a Node.js environment.
const fs = require("fs");

// --- CONFIGURATION ---
// Scraper settings are configured here.
// Input data is loaded from CSV files.
const CONFIG = {
    // Number of requests to run in parallel at any given time.
    CONCURRENT_BATCH_SIZE: 2,
    // Milliseconds to wait between each request to avoid rate-limiting.
    REQUEST_DELAY_MS: 3000,
    // Number of times to retry a failed request.
    RETRY_ATTEMPTS: 3,
    // Seconds to wait before the first retry (this will double on each subsequent retry).
    RETRY_BACKOFF_FACTOR: 2,
    // File paths for input data
    CATEGORIES_FILE: "blinkit_categories.csv",
    LOCATIONS_FILE: "blinkit_locations.csv",
};

class BlinkitScraper {
    constructor(config) {
        this.config = config;
        this.allProducts = [];
        this.tasks = [];
    }

    /**
     * Reads a CSV file and converts it to an array of objects.
     * @param {string} filePath - The path to the CSV file.
     * @returns {Array<object>|null} Parsed data or null on error.
     */
    _readCSV(filePath) {
        try {
            const fileContent = fs.readFileSync(filePath, "utf8");
            const rows = fileContent.trim().split("\n");
            if (rows.length < 2) return [];

            // Simple CSV header parsing (handles quoted headers)
            const headers = rows[0]
                .split(",")
                .map((h) => h.trim().replace(/"/g, ""));

            const data = rows.slice(1).map((row) => {
                // Simple CSV row parsing (handles quoted values)
                const values = row
                    .split(",")
                    .map((v) => v.trim().replace(/"/g, ""));
                const entry = {};
                headers.forEach((header, index) => {
                    entry[header] = values[index];
                });
                return entry;
            });

            console.log(
                `Successfully read ${data.length} rows from ${filePath}`
            );
            return data;
        } catch (error) {
            console.error(
                `Failed to read or parse CSV file at ${filePath}: ${error.message}`
            );
            return null;
        }
    }

    /**
     * Main function to start the scraping process.
     */
    async run() {
        console.info("Starting scraper...");

        // Load data from input files
        const locations = this._readCSV(this.config.LOCATIONS_FILE);
        const categories = this._readCSV(this.config.CATEGORIES_FILE);

        if (!locations || !categories) {
            console.error("Could not load input files. Aborting scraping.");
            return;
        }

        // Generate all task combinations
        this.tasks = locations.flatMap((loc) =>
            categories.map((cat) => ({ location: loc, category: cat }))
        );

        if (this.tasks.length === 0) {
            console.error("No tasks generated. Check input files.");
            return;
        }
        console.info(`Generated ${this.tasks.length} tasks to process.`);

        // Process tasks in batches
        for (
            let i = 0;
            i < this.tasks.length;
            i += this.config.CONCURRENT_BATCH_SIZE
        ) {
            const batch = this.tasks.slice(
                i,
                i + this.config.CONCURRENT_BATCH_SIZE
            );
            console.info(
                `Processing batch ${
                    Math.floor(i / this.config.CONCURRENT_BATCH_SIZE) + 1
                }...`
            );

            const batchPromises = batch.map((task) =>
                this._getBlinkitDataWithRetries(task.location, task.category)
            );

            // Wait for the current batch to complete
            const results = await Promise.all(batchPromises);
            results.forEach((products) => {
                if (products && products.length > 0) {
                    this.allProducts.push(...products);
                }
            });
        }

        this._onScrapingComplete();
    }

    _onScrapingComplete() {
        console.log(
            `Scraping complete. Found ${this.allProducts.length} total products.`
        );
        if (this.allProducts.length > 0) {
            const csvData = this._convertToCSV(this.allProducts);
            const fileName = `output_${
                new Date().toISOString().split("T")[0]
            }.csv`;
            this._saveCSV(csvData, fileName);
        } else {
            console.error("No products were found to save.");
        }
    }

    async _getBlinkitDataWithRetries(location, category) {
        const l2Name = category.l2_category;
        for (
            let attempt = 1;
            attempt <= this.config.RETRY_ATTEMPTS;
            attempt++
        ) {
            try {
                // Wait before making the request
                await new Promise((resolve) =>
                    setTimeout(resolve, this.config.REQUEST_DELAY_MS)
                );

                const products = await this._getBlinkitData(location, category);
                console.log(
                    `✅ Success: ${location.longitude} & ${location.latitude} -> ${l2Name}`
                );
                return products;
            } catch (error) {
                console.error(
                    `❌ Attempt ${attempt} failed for ${location.longitude} & ${location.latitude}
                     -> ${l2Name}: ${error.message}`
                );
                if (attempt === this.config.RETRY_ATTEMPTS) {
                    console.error(
                        `Skipping task for ${l2Name} after all retries failed.`
                    );
                    return []; // Return empty array on final failure
                }
                const delay =
                    this.config.RETRY_BACKOFF_FACTOR * 2 ** (attempt - 1);
                console.info(`Retrying in ${delay} seconds...`);
                await new Promise((resolve) =>
                    setTimeout(resolve, delay * 1000)
                );
            }
        }
    }

    async _getBlinkitData(location, category) {
        const { l1_category_id, l2_category_id } = category;
        const url = `https://blinkit.com/v1/layout/listing_widgets?l0_cat=${l1_category_id}&l1_cat=${l2_category_id}`;
        const headers = {
            "content-type": "application/json",
            lat: location.latitude,
            lon: location.longitude,
        };

        const response = await fetch(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({}),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseJson = await response.json();
        return this._extractProductData(responseJson, category);
    }

    _extractProductData(responseJson, category) {
        const { l1_category, l1_category_id, l2_category, l2_category_id } =
            category;
        const products = [];
        const snippets = responseJson?.response?.snippets;
        if (!snippets || !Array.isArray(snippets)) return products;

        for (const item of snippets) {
            if (item?.widget_type !== "product_card_snippet_type_2") continue;
            const cartItem = item?.data?.atc_action?.add_to_cart?.cart_item;
            if (!cartItem) continue;

            const trackingAttrs = item?.tracking?.common_attributes;
            const isSponsored = trackingAttrs?.badge === "AD" ? 1 : 0;
            const inventory = cartItem.inventory || 0;

            products.push({
                date: new Date().toISOString().split("T")[0],
                l1_category: l1_category,
                l1_category_id: l1_category_id,
                l2_category: l2_category,
                l2_category_id: l2_category_id,
                store_id: cartItem.merchant_id,
                variant_id: cartItem.product_id,
                variant_name: cartItem.product_name,
                group_id: cartItem.group_id,
                selling_price: cartItem.price,
                mrp: cartItem.mrp,
                in_stock: inventory > 0 ? 1 : 0,
                inventory: inventory,
                is_sponsored: isSponsored,
                image_url: cartItem.image_url,
                brand_id: cartItem.brand,
                brand: cartItem.brand,
            });
        }
        return products;
    }

    _convertToCSV(data) {
        if (!data || data.length === 0) return "";
        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(",")];
        for (const row of data) {
            const values = headers.map((header) => {
                let value = row[header];
                if (typeof value === "string" && value.includes(",")) {
                    value = `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            });
            csvRows.push(values.join(","));
        }
        return csvRows.join("\n");
    }

    _saveCSV(csvContent, fileName) {
        try {
            fs.writeFileSync(fileName, csvContent, "utf8");
            console.log(`Successfully saved data to ${fileName}`);
        } catch (error) {
            console.error(`Failed to save CSV file: ${error.message}`);
        }
    }
}

// --- Main Execution ---
// To run the script, create an instance of the class and call the .run() method.
const scraper = new BlinkitScraper(CONFIG);
scraper.run();
