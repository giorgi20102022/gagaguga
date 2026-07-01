from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from urllib.parse import quote
import time
import random

# -------------------------
# 🧠 MESSAGE GENERATOR
# -------------------------
styles = [
    "✔️ {text}",
    "🚀 {text}",
    "⚡ {text}",
    "🔔 {text}",
    "✨ {text}"
]

variations = [
    "წარმატებით შესრულდა ყველაფერი და მომხმარებელი დარეგისტრირდა",
    "ოპერაცია დასრულდა წარმატებით და მომხმარებელი დაემატა სისტემაში",
    "რეგისტრაცია წარმატებით განხორციელდა",
    "ყველა პროცესი წარმატებით შესრულდა",
    "მოქმედება წარმატებით დასრულდა და მომხმარებელი დაემატა"
]

def generate_message():
    text = random.choice(variations)
    style = random.choice(styles)
    return style.format(text=text)

# -------------------------
# 🧱 SELENIUM SETUP
# -------------------------
options = Options()

options.add_argument("--disable-gpu")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--start-maximized")
options.add_argument(r"--user-data-dir=C:\temp\wa_session")

# hidden window (not fully headless, stable)
options.add_argument("--window-position=-2000,0")
options.add_argument("--window-size=1200,800")

driver = webdriver.Chrome(
    service=Service(ChromeDriverManager().install()),
    options=options
)

wait = WebDriverWait(driver, 40)

# -------------------------
# 🌐 OPEN WHATSAPP
# -------------------------
driver.get("https://web.whatsapp.com")
print("QR დაასკანერე ერთხელ...")

wait.until(EC.presence_of_element_located((By.XPATH, "//div[@aria-label='Chat list']")))
print("შესულია ✅")

# -------------------------
# 📱 SEND MESSAGE
# -------------------------
phone = "995568921496"

message = generate_message()   # 🔥 HERE IS THE MAGIC

print("Message:", message)

driver.get(f"https://web.whatsapp.com/send?phone={phone}&text={quote(message)}")

box = wait.until(
    EC.presence_of_element_located((By.XPATH, "//div[@contenteditable='true']"))
)   

box.click()
time.sleep(1)
box.send_keys(Keys.ENTER)

print("გაიგზავნა ⚡      ")

time.sleep(2)
driver.quit()