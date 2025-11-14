import json
import csv
import sys
from typing import Any, Dict, List

def remove_nested_keys(entry: Dict[str, Any]) -> Dict[str, Any]:
    """
    Removes keys whose value is a dict or a list of dicts (i.e., nested).
    Lists of primitives are kept (joined by ';').
    """
    out = {}
    for k, v in entry.items():
        if isinstance(v, dict):
            continue  # Skip nested dicts
        elif isinstance(v, list):
            if all(isinstance(i, dict) for i in v):
                continue  # Skip lists of dicts (nested)
            else:
                out[k] = ';'.join(str(i) for i in v)
        else:
            out[k] = v
    return out

def json_to_csv(json_path: str, csv_path: str):
    with open(json_path, 'r', encoding='utf-8') as json_file:
        data = json.load(json_file)
    if isinstance(data, dict):
        data = [data]  # make it a list

    # Remove nested columns from each object
    flat_data: List[Dict[str, Any]] = []
    for entry in data:
        flat_data.append(remove_nested_keys(entry))

    # Determine all fieldnames
    fieldnames = set()
    for row in flat_data:
        fieldnames.update(row.keys())
    fieldnames = sorted(list(fieldnames))

    with open(csv_path, 'w', newline='', encoding='utf-8') as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        for row in flat_data:
            writer.writerow(row)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python jsontocsv.py input.json output.csv")
        sys.exit(1)
    json_to_csv(sys.argv[1], sys.argv[2])
