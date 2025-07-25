# Blinkit Product Scraper

This project provides two robust, production-level scripts for scraping product data from the Blinkit (formerly Grofers) website: a primary version in Node.js and an alternative in Python using Selenium. Both are designed to be resilient, efficient, and easy to configure.

---

## 1. Node.js Scraper

For users who prefer JavaScript or need a lightweight, non-browser-based solution, this Node.js version of the scraper is ideal. It uses direct HTTP requests and is suitable for environments where installing a full browser is not feasible.

### Key Features

-   **Standalone Script**: Runs in a Node.js environment without needing a browser.
-   **Lightweight**: Uses `fetch` for direct, efficient HTTP requests.
-   **Concurrent Processing**: Processes requests in parallel batches to improve speed.
-   **Rate-Limiting Aware**: Includes configurable delays and automatic retries to handle `429 (Too Many Requests)` errors.
-   **File System I/O**: Reads input from the same CSV files and saves the output directly to the disk using Node's built-in `fs` module.

### Prerequisites

-   Node.js (LTS version recommended)
-   `npm` (Node Package Manager)

### Running

Execute the JavaScript file using Node.js:

```
node scraper.js
```

The script will log its progress in the console and save the final CSV to your project folder.

---

## 2. Python Scraper (using Selenium)

To overcome anti-scraping measures that HTTP request by **Python** faced which resulted in `403 Forbidden` errors, this scraper uses **Selenium** to automate a real Chrome browser. This ensures that all API requests originate from a legitimate browser session, making them much more likely to succeed.

### Key Features

-   **Resilient Scraping**: Uses Selenium to automate a real browser, bypassing common anti-bot protections.
-   **Concurrent Processing**: Utilizes a `ThreadPoolExecutor` to run multiple scraping tasks in parallel, significantly speeding up the process.
-   **Configurable**: All settings (file paths, concurrency level, delays) are managed in an external `config.ini` file, so no code changes are needed for adjustments.
-   **Automatic Retries**: Automatically retries failed requests with an exponential backoff delay to handle temporary network issues or rate-limiting.
-   **Efficient Data Handling**: Reads input from CSV files and uses the `pandas` library to efficiently collect all results and write them to a single, clean CSV file.
-   **Modular Code**: The script is organized into a clean, object-oriented structure, making it easy to read, maintain, and extend.

### Prerequisites

-   Python 3.7+
-   Google Chrome browser
-   `pip` (Python package installer)

### Setup Instructions

Follow these steps to set up and run the scraper on your local machine.

#### 1. Set Up a Virtual Environment (Recommended)

Create the virtual environment

```
python -m venv venv
```

#### 2. Activate it

On macOS/Linux:

```
source venv/bin/activate
```

#### 3. Install Dependencies

```
pip install -r requirements.txt
```

### Running the Scraper

```
python scraper.py
```
