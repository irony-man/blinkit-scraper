import pandas as pd
import os
import time
import logging
import configparser
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(threadName)s] - %(levelname)s - %(message)s')

class BlinkitSeleniumScraper:
    """
    A production-ready scraper for the Blinkit API using Selenium to bypass anti-bot measures.
    """
    def __init__(self, config_path='config.ini'):
        """Initializes the scraper by loading configuration."""
        logging.info("Initializing Selenium-based scraper...")
        self.config = self._load_config(config_path)

    def _load_config(self, config_path):
        """Loads settings from the config.ini file."""
        if not os.path.exists(config_path):
            logging.error(f"FATAL: Configuration file not found at {config_path}")
            exit()
        
        config = configparser.ConfigParser()
        config.read(config_path)
        
        return {
            'api': dict(config.items('API')),
            'files': dict(config.items('Files')),
            'scraper': {
                'max_workers': config.getint('Scraper', 'max_workers'),
                'retry_attempts': config.getint('Scraper', 'retry_attempts'),
                'retry_backoff_factor': config.getfloat('Scraper', 'retry_backoff_factor'),
                'request_delay_ms': config.getint('Scraper', 'request_delay_ms'),
            }
        }

    def _create_driver(self):
        """Creates and configures a new Selenium WebDriver instance."""
        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--user-agent=Mozilla/5.0')
        
        service = Service()
        return webdriver.Chrome(service=service, options=chrome_options)

    def _read_csv(self, file_path):
        """Reads a CSV file into a pandas DataFrame."""
        try:
            df = pd.read_csv(file_path)
            logging.info(f"Successfully read {len(df)} rows from {file_path}")
            return df
        except FileNotFoundError:
            logging.error(f"FATAL: Input file not found at {file_path}.")
            return None

    def _process_task_with_selenium(self, task):
        """
        Processes a single location-category pair using a dedicated browser instance.
        """
        location, category = task
        driver = None
        try:
            driver = self._create_driver()
            # Initial visit to establish session
            driver.get("https://blinkit.com/")
            time.sleep(5) # Allow page and any anti-bot scripts to load

            l2_name = category['l2_category']
            
            for attempt in range(self.config['scraper']['retry_attempts']):
                try:
                    time.sleep(self.config['scraper']['request_delay_ms'] / 1000)
                    
                    api_url = f"{self.config['api']['base_url']}?l0_cat={category['l1_category_id']}&l1_cat={category['l2_category_id']}"
                    
                    # JavaScript to execute fetch within the browser context
                    script = f"""
                    return fetch('{api_url}', {{
                        method: 'POST',
                        headers: {{
                            'Content-Type': 'application/json',
                            'lat': '{location['latitude']}',
                            'lon': '{location['longitude']}'
                        }},
                        body: JSON.stringify({{}})
                    }}).then(response => {{
                        if (!response.ok) {{
                            return Promise.reject(new Error(`HTTP error! status: ${{response.status}}`));
                        }}
                        return response.json();
                    }});
                    """
                    response_json = driver.execute_script(script)
                    
                    if response_json:
                        return self._extract_product_data(response_json, category)
                    
                except Exception as e:
                    logging.warning(f"Attempt {attempt + 1} failed for {l2_name}: {e}")
                    if attempt + 1 == self.config['scraper']['retry_attempts']:
                        logging.error(f"All retries failed for {l2_name}.")
                        return []
                    backoff_time = self.config['scraper']['retry_backoff_factor'] * (2 ** attempt)
                    time.sleep(backoff_time)
            return []
        finally:
            if driver:
                driver.quit()

    def _extract_product_data(self, response_json, category):
        """Extracts product data from the API response."""
        products = []
        snippets = response_json.get("response", {}).get("snippets", [])

        for item in snippets:
            if item.get("widget_type") != "product_card_snippet_type_2":
                continue
            
            cart_item = item.get("data", {}).get("atc_action", {}).get("add_to_cart", {}).get("cart_item")
            if not cart_item:
                continue
            
            tracking_attrs = item.get("tracking", {}).get("common_attributes", {})
            is_sponsored = 1 if tracking_attrs.get("badge") == "AD" else 0
            inventory = cart_item.get("inventory", 0)

            products.append({
                "date": datetime.now().strftime("%Y-%m-%d"),
                "l1_category": category['l1_category'], "l1_category_id": category['l1_category_id'],
                "l2_category": category['l2_category'], "l2_category_id": category['l2_category_id'],
                "store_id": cart_item.get("merchant_id"), "variant_id": cart_item.get("product_id"),
                "variant_name": cart_item.get("product_name"), "group_id": cart_item.get("group_id"),
                "selling_price": cart_item.get("price"), "mrp": cart_item.get("mrp"),
                "in_stock": 1 if inventory > 0 else 0, "inventory": inventory,
                "is_sponsored": is_sponsored, "image_url": cart_item.get("image_url"),
                "brand_id": cart_item.get("brand"), "brand": cart_item.get("brand"),
            })
        return products

    def run(self):
        """Main function to orchestrate the scraping process."""
        locations_df = self._read_csv(self.config['files']['locations_csv'])
        categories_df = self._read_csv(self.config['files']['categories_csv'])

        if locations_df is None or categories_df is None:
            return

        tasks = [(loc, cat) for _, loc in locations_df.iterrows() for _, cat in categories_df.iterrows()]
        logging.info(f"Generated {len(tasks)} tasks to process.")
        
        all_results = []
        completed_count = 0
        total_tasks = len(tasks)

        with ThreadPoolExecutor(max_workers=self.config['scraper']['max_workers']) as executor:
            future_to_task = {executor.submit(self._process_task_with_selenium, task): task for task in tasks}
            for future in as_completed(future_to_task):
                try:
                    result = future.result()
                    if result:
                        all_results.extend(result)
                except Exception as e:
                    logging.error(f"Task generated an exception: {e}")
                
                completed_count += 1
                logging.info(f"Progress: {completed_count}/{total_tasks} tasks completed.")


        logging.info(f"Scraping complete. Found {len(all_results)} total products.")
        if all_results:
            self._save_results(all_results)

    def _save_results(self, all_results):
        """Saves the collected data to a single CSV file."""
        final_df = pd.DataFrame(all_results)
        file_path = self.config['files']['output_csv']
        final_df.to_csv(file_path, index=False, encoding='utf-8')
        logging.info(f"Successfully saved {len(final_df)} rows to {file_path}")

if __name__ == "__main__":
    scraper = BlinkitSeleniumScraper()
    scraper.run()
