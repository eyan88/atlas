import datetime
from thetadata import ThetaClient
client = ThetaClient(email='gpse4476@gmail.com', password='Darkmagic10', dataframe_type='pandas')
exps = client.option_list_expirations('SPY')['expiration']
exp_dates = []
for e in exps:
    if isinstance(e, str):
        try:
            exp_dates.append(datetime.date.fromisoformat(e))
        except:
            exp_dates.append(datetime.date(int(e[:4]), int(e[4:6]), int(e[6:8])))
    elif isinstance(e, int):
        exp_dates.append(datetime.date(e//10000, (e//100)%100, e%100))

exp = sorted([e for e in exp_dates if e >= datetime.date(2026, 7, 2)])[0]
df = client.option_history_greeks_eod('SPY', exp, datetime.date(2026, 7, 2), datetime.date(2026, 7, 2))
print("COLUMNS:")
print(df.columns)
