import requests
import pandas as pd

# Define the SPARQL query
query = """
SELECT ?landmark ?landmarkLabel ?coord ?cityLabel ?countryLabel ?sitelinks
WHERE {
  ?landmark wdt:P31/wdt:P279* wd:Q839954 ;  # landmark or subclass
            wdt:P625 ?coord ;
            wdt:P131 ?city ;
            wikibase:sitelinks ?sitelinks .
  ?city wdt:P31/wdt:P279* wd:Q515 ;
        wdt:P17 ?country .

  SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
}
ORDER BY DESC(?sitelinks)
LIMIT 1000

"""

# Set up the endpoint URL and headers
url = "https://query.wikidata.org/sparql"
headers = { "Accept": "application/sparql-results+json" }

print("Sending SPARQL query...")
response = requests.get(url, headers=headers, params={"query": query})

# Check response status
if response.status_code != 200:
    print(f"❌ HTTP Error {response.status_code}")
    print(response.text)
    raise SystemExit()

# Try parsing JSON
try:
    results_json = response.json()
except ValueError:
    print("❌ Failed to parse JSON. Response may not be valid JSON:")
    print(response.text[:500])  # Print first 500 chars
    raise SystemExit()

print("Parsing response...")
results = response.json()["results"]["bindings"]
total = len(results)
print(f"Found {total} results. Processing...")

# Convert to pandas DataFrame with progress feedback
data = []
for i, r in enumerate(results, 1):
    try:
        landmark = r["landmarkLabel"]["value"]
        coord = r["coord"]["value"]
        city = r["cityLabel"]["value"]
        country = r["countryLabel"]["value"]
        data.append((landmark, coord, city, country))
    except KeyError as e:
        print(f"⚠️ Skipped item {i} due to missing field: {e}")
        continue

    if i % 100 == 0 or i == total:
        print(f"Processed {i}/{total} landmarks...")

df = pd.DataFrame(data, columns=["Landmark", "Coordinates", "City", "Country"])

print("Saving to landmarks.csv...")
df.to_csv("landmarks.csv", index=False)
print("✅ Done! File saved as landmarks.csv")
