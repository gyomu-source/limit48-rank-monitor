import json
import pandas as pd

def prepare_chart_data(history_file):
    with open(history_file, 'r', encoding='utf-8') as f:
        history = json.load(f)

    chart_data = {
        'labels': [],
        'rakuten': {
            'ファスティング': {'totalRank': [], 'organicRank': [], 'prCount': []},
            '酵素ドリンク': {'totalRank': [], 'organicRank': [], 'prCount': []}
        },
        'amazon': {
            'ファスティング': {'totalRank': [], 'organicRank': [], 'prCount': []},
            '酵素ドリンク': {'totalRank': [], 'organicRank': [], 'prCount': []}
        }
    }

    for entry in history:
        chart_data['labels'].append(entry['dateStr'] + ' ' + entry['timeStr'])

        # Check for the new schema (with 'rakuten' and 'amazon' keys)
        if 'rakuten' in entry['results'] and 'amazon' in entry['results']:
            for platform in ['rakuten', 'amazon']:
                for keyword in ['ファスティング', '酵素ドリンク']:
                    result = entry['results'][platform].get(keyword, {})
                    
                    total_rank = result.get('rank')
                    chart_data[platform][keyword]['totalRank'].append(total_rank if total_rank is not None else 101)
                    
                    organic_rank = result.get('organicRank')
                    chart_data[platform][keyword]['organicRank'].append(organic_rank if organic_rank is not None else 101)
                    
                    pr_count = result.get('prCount')
                    chart_data[platform][keyword]['prCount'].append(pr_count if pr_count is not None else 0)
        else:
            # Handle old schema (Rakuten only, keywords directly under 'results')
            for keyword in ['ファスティング', '酵素ドリンク']:
                result = entry['results'].get(keyword, {})
                
                # Rakuten data
                total_rank_rakuten = result.get('rank')
                chart_data['rakuten'][keyword]['totalRank'].append(total_rank_rakuten if total_rank_rakuten is not None else 101)
                
                organic_rank_rakuten = result.get('organicRank')
                chart_data['rakuten'][keyword]['organicRank'].append(organic_rank_rakuten if organic_rank_rakuten is not None else 101)
                
                pr_count_rakuten = result.get('prCount')
                chart_data['rakuten'][keyword]['prCount'].append(pr_count_rakuten if pr_count_rakuten is not None else 0)
                
                # Amazon data (fill with default values for old entries)
                chart_data['amazon'][keyword]['totalRank'].append(101) # Not applicable
                chart_data['amazon'][keyword]['organicRank'].append(101) # Not applicable
                chart_data['amazon'][keyword]['prCount'].append(0) # Not applicable

    return chart_data

if __name__ == '__main__':
    history_file = path.join(path.dirname(__file__), 'rank_history.json')
    data = prepare_chart_data(history_file)
    with open('/home/ubuntu/limit48-rank-monitor/chart_data.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Chart data prepared and saved to chart_data.json")
