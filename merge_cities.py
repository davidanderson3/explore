
import json

def merge_cities():
    with open('assets/cities.geojson', 'r') as f:
        existing_data = json.load(f)

    with open('cities.json', 'r') as f:
        new_data = json.load(f)

    existing_city_names = {feature['properties']['NAME'] for feature in existing_data['features']}
    new_features = []
    for city in new_data:
        if city['name'] not in existing_city_names:
            new_feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [city['lng'], city['lat']]
                },
                "properties": {
                    "NAME": city['name']
                }
            }
            new_features.append(new_feature)

    existing_data['features'].extend(new_features)

    with open('assets/cities.geojson', 'w') as f:
        json.dump(existing_data, f, indent=2)

if __name__ == '__main__':
    merge_cities()
