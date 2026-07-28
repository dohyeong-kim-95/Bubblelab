// 데이터사이언스 문제은행. 모든 파이썬 코드는 String.raw로 담아
// 백슬래시(정규식 \d, "\n" 등)가 그대로 파이썬에 전달되게 한다.
// steps[i].solution은 setup + 이전 단계 solution들이 실행된 네임스페이스에서
// 이어서 실행된다(노트북 흐름과 동일). expect의 변수들이 채점 대상.
window.DS_PROBLEMS = [
  {
    id: "clean-missing",
    title: "카페 주문 결측치 처리",
    category: "데이터 클렌징",
    level: 1,
    tags: ["isna", "fillna", "groupby"],
    intro: "지점별 카페 주문 데이터에서 결측치를 파악하고, 규칙에 따라 처리한 뒤 지점별 매출을 집계합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(7)
n = 200
branches = rng.choice(["강남", "홍대", "판교", "성수"], n)
menus = rng.choice(["아메리카노", "라떼", "쿠키", "케이크"], n, p=[0.4, 0.3, 0.2, 0.1])
base_price = {"아메리카노": 4500.0, "라떼": 5000.0, "쿠키": 3000.0, "케이크": 6500.0}
qty = rng.integers(1, 6, n).astype(float)
price = np.array([base_price[m] for m in menus])
qty[rng.choice(n, 12, replace=False)] = np.nan
price[rng.choice(n, 15, replace=False)] = np.nan
df = pd.DataFrame({
    "order_id": np.arange(1, n + 1),
    "branch": branches,
    "menu": menus,
    "qty": qty,
    "price": price,
})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "결측 규모 파악",
        prompt: "전체 결측 셀 개수를 `n_missing`에, 결측이 하나라도 있는 행의 수를 `n_rows_missing`에 담으세요. (힌트: `isna()`)",
        expect: ["n_missing", "n_rows_missing"],
        hint: "df.isna().sum().sum() 과 df.isna().any(axis=1).sum()",
        solution: String.raw`n_missing = int(df.isna().sum().sum())
n_rows_missing = int(df.isna().any(axis=1).sum())`,
      },
      {
        id: "s2",
        title: "규칙 기반 대치와 제거",
        prompt: "`df`를 복사해 `df2`를 만들고 ① `price` 결측은 **메뉴별 중앙값**으로 대치 ② `qty` 결측 행은 제거 ③ `reset_index(drop=True)` 하세요.",
        expect: ["df2"],
        hint: "groupby('menu')['price'].transform(...) 으로 메뉴별 중앙값을 채운 뒤 dropna(subset=['qty'])",
        solution: String.raw`df2 = df.copy()
df2["price"] = df2.groupby("menu")["price"].transform(lambda s: s.fillna(s.median()))
df2 = df2.dropna(subset=["qty"]).reset_index(drop=True)`,
      },
      {
        id: "s3",
        title: "지점별 매출 집계",
        prompt: "`df2`에 `sales` 컬럼(`qty * price`)을 추가하고, 지점별 `sales` 합계를 **내림차순 정렬한 Series** `sales_by_branch`에 담으세요.",
        expect: ["sales_by_branch"],
        hint: "groupby('branch')['sales'].sum().sort_values(ascending=False)",
        solution: String.raw`df2["sales"] = df2["qty"] * df2["price"]
sales_by_branch = df2.groupby("branch")["sales"].sum().sort_values(ascending=False)`,
      },
    ],
  },

  {
    id: "outlier-iqr",
    title: "배달 시간 이상치(IQR)",
    category: "데이터 클렌징",
    level: 1,
    tags: ["quantile", "IQR", "clip"],
    intro: "배달 소요시간 데이터에서 IQR 규칙으로 이상치를 찾아 제거·대치했을 때의 차이를 확인합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(11)
minutes = np.concatenate([
    rng.normal(32, 6, 180),
    rng.normal(75, 8, 8),
    rng.normal(9, 2, 4),
]).round(1)
df = pd.DataFrame({"delivery_id": np.arange(1, len(minutes) + 1), "minutes": minutes})
df.describe()`,
    steps: [
      {
        id: "s1",
        title: "사분위수와 IQR",
        prompt: "`minutes`의 1사분위수를 `q1`, 3사분위수를 `q3`, IQR을 `iqr`에 담으세요. (`quantile` 사용)",
        expect: ["q1", "q3", "iqr"],
        hint: "df['minutes'].quantile(0.25) / quantile(0.75)",
        solution: String.raw`q1 = float(df["minutes"].quantile(0.25))
q3 = float(df["minutes"].quantile(0.75))
iqr = q3 - q1`,
      },
      {
        id: "s2",
        title: "이상치 탐지",
        prompt: "하한 `q1 - 1.5*iqr`, 상한 `q3 + 1.5*iqr`을 벗어나는 이상치 개수를 `n_out`에 담으세요.",
        expect: ["n_out"],
        hint: "불리언 마스크를 만들어 sum()",
        solution: String.raw`lower = q1 - 1.5 * iqr
upper = q3 + 1.5 * iqr
mask_out = (df["minutes"] < lower) | (df["minutes"] > upper)
n_out = int(mask_out.sum())`,
      },
      {
        id: "s3",
        title: "제거 vs 대치",
        prompt: "① 이상치를 **제거**한 평균을 `mean_clean` ② 이상치를 상·하한 값으로 **대치(clip)**한 평균을 `mean_clip`에 담으세요.",
        expect: ["mean_clean", "mean_clip"],
        hint: "df.loc[~mask, 'minutes'].mean() 과 df['minutes'].clip(lower, upper).mean()",
        solution: String.raw`mean_clean = float(df.loc[~mask_out, "minutes"].mean())
mean_clip = float(df["minutes"].clip(lower, upper).mean())`,
      },
    ],
  },

  {
    id: "scaling",
    title: "성적 데이터 스케일링",
    category: "변환·스케일링",
    level: 1,
    tags: ["StandardScaler", "MinMaxScaler", "z-score"],
    intro: "세 과목 성적을 표준화/정규화하고 극단값 학생 수를 셉니다. StandardScaler는 ddof=0 표준편차를 씁니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(3)
n = 150
df = pd.DataFrame({
    "student_id": np.arange(1, n + 1),
    "math": np.clip(rng.normal(65, 15, n), 0, 100).round(1),
    "english": np.clip(rng.normal(70, 10, n), 0, 100).round(1),
    "science": np.clip(rng.normal(60, 20, n), 0, 100).round(1),
})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "표준화 (z-score)",
        prompt: "`StandardScaler`로 `math, english, science`를 표준화해 **같은 컬럼명의 DataFrame** `df_std`를 만들고, `math` 표준화 값의 최댓값을 `zmax`에 담으세요.",
        expect: ["df_std", "zmax"],
        hint: "pd.DataFrame(scaler.fit_transform(X), columns=X.columns)",
        solution: String.raw`from sklearn.preprocessing import StandardScaler
cols = ["math", "english", "science"]
df_std = pd.DataFrame(StandardScaler().fit_transform(df[cols]), columns=cols)
zmax = float(df_std["math"].max())`,
      },
      {
        id: "s2",
        title: "min-max 정규화",
        prompt: "`MinMaxScaler`로 같은 세 과목을 0~1로 정규화한 `df_mm`을 만들고, `english`의 평균을 `mm_mean`에 담으세요.",
        expect: ["df_mm", "mm_mean"],
        hint: "MinMaxScaler().fit_transform(...)",
        solution: String.raw`from sklearn.preprocessing import MinMaxScaler
df_mm = pd.DataFrame(MinMaxScaler().fit_transform(df[cols]), columns=cols)
mm_mean = float(df_mm["english"].mean())`,
      },
      {
        id: "s3",
        title: "수동 z-score와 극단값",
        prompt: "수식 `(x - 평균) / 표준편차(ddof=0)`로 `math`를 직접 표준화하고, |z| > 2 인 학생 수를 `n_extreme`에 담으세요.",
        expect: ["n_extreme"],
        hint: "df['math'].std(ddof=0) — pandas 기본은 ddof=1이니 주의",
        solution: String.raw`z = (df["math"] - df["math"].mean()) / df["math"].std(ddof=0)
n_extreme = int((z.abs() > 2).sum())`,
      },
    ],
  },

  {
    id: "transform-dummy",
    title: "왜도 완화와 가변수",
    category: "변환·스케일링",
    level: 2,
    tags: ["skew", "log1p", "get_dummies"],
    intro: "치우친 주택 가격 분포를 로그 변환으로 완화하고, 범주형 변수를 더미(가변수)로 바꿉니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(21)
n = 300
house_type = rng.choice(["아파트", "빌라", "오피스텔"], n, p=[0.5, 0.3, 0.2])
rooms = rng.integers(1, 6, n)
area = np.clip(rng.normal(70, 20, n), 20, 150).round(1)
price = (np.exp(rng.normal(0, 0.5, n)) * (area * 90 + rooms * 2000)).round(0)
df = pd.DataFrame({"type": house_type, "rooms": rooms, "area": area, "price": price})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "왜도와 로그 변환",
        prompt: "`price`의 왜도를 `skew_before`에, `np.log1p` 변환 후의 왜도를 `skew_after`에 담으세요.",
        expect: ["skew_before", "skew_after"],
        hint: "Series.skew() 사용, 변환은 np.log1p(df['price'])",
        solution: String.raw`skew_before = float(df["price"].skew())
skew_after = float(np.log1p(df["price"]).skew())`,
      },
      {
        id: "s2",
        title: "가변수 생성",
        prompt: "`pd.get_dummies(df, columns=['type'])`로 더미를 만들고 더미 컬럼들을 `astype(int)`로 바꾼 `df_d`를 만드세요. 더미 컬럼 수는 `n_dummy_cols`에.",
        expect: ["df_d", "n_dummy_cols"],
        hint: "더미 컬럼명은 'type_'로 시작합니다",
        solution: String.raw`df_d = pd.get_dummies(df, columns=["type"])
dummy_cols = [c for c in df_d.columns if c.startswith("type_")]
df_d[dummy_cols] = df_d[dummy_cols].astype(int)
n_dummy_cols = len(dummy_cols)`,
      },
      {
        id: "s3",
        title: "이진 변수",
        prompt: "방이 3개 이상이면 1, 아니면 0인 이진 변수를 만들어 그 합(3룸 이상 개수)을 `n_large`에 담으세요.",
        expect: ["n_large"],
        hint: "(df['rooms'] >= 3).astype(int).sum()",
        solution: String.raw`n_large = int((df["rooms"] >= 3).astype(int).sum())`,
      },
    ],
  },

  {
    id: "feature-dates",
    title: "주문 로그 날짜 파생변수",
    category: "피처 엔지니어링",
    level: 2,
    tags: ["to_datetime", "rename", "shift", "rank"],
    intro: "문자열 타임스탬프를 날짜형으로 바꾸고 월/요일/주말 파생변수와 순위 변수를 만듭니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(5)
n = 400
base = pd.Timestamp("2024-01-01")
ts = base + pd.to_timedelta(rng.integers(0, 90 * 24 * 60, n), unit="m")
df = pd.DataFrame({
    "log_id": np.arange(1, n + 1),
    "ts": ts.astype(str),
    "amt": rng.gamma(2.0, 15000, n).round(-2),
})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "이름 변경과 날짜 파생",
        prompt: "컬럼명을 `ts→ordered_at`, `amt→amount`로 바꾸고 `ordered_at`을 datetime으로 변환하세요. `month`, `weekday`(월=0) 컬럼을 만들고 주말(토·일) 주문 수를 `n_weekend`, 3월 주문 수를 `n_march`에 담으세요.",
        expect: ["n_weekend", "n_march"],
        hint: "rename(columns={...}), dt.month, dt.weekday",
        solution: String.raw`df = df.rename(columns={"ts": "ordered_at", "amt": "amount"})
df["ordered_at"] = pd.to_datetime(df["ordered_at"])
df["month"] = df["ordered_at"].dt.month
df["weekday"] = df["ordered_at"].dt.weekday
n_weekend = int((df["weekday"] >= 5).sum())
n_march = int((df["month"] == 3).sum())`,
      },
      {
        id: "s2",
        title: "일별 집계와 전일 대비",
        prompt: "날짜(일 단위)별 `amount` 합계 Series `daily`를 만들고, 전일보다 매출이 **증가한 날의 수**를 `n_up`, 일 매출 최댓값을 `max_daily`에 담으세요. (`diff()` 또는 `shift(1)` 비교)",
        expect: ["n_up", "max_daily"],
        hint: "df.groupby(df['ordered_at'].dt.date)['amount'].sum() 후 diff() > 0",
        solution: String.raw`daily = df.groupby(df["ordered_at"].dt.date)["amount"].sum()
n_up = int((daily.diff() > 0).sum())
max_daily = float(daily.max())`,
      },
      {
        id: "s3",
        title: "순위 변수",
        prompt: "`amount` 내림차순 순위를 `rank(ascending=False, method='min')`으로 만들어 순위 10위 이내 건수를 `n_top10`, 상위 10개 금액 합을 `top10_sum`에 담으세요.",
        expect: ["n_top10", "top10_sum"],
        hint: "순위 컬럼 <= 10 개수, nlargest(10).sum()",
        solution: String.raw`df["amt_rank"] = df["amount"].rank(ascending=False, method="min")
n_top10 = int((df["amt_rank"] <= 10).sum())
top10_sum = float(df["amount"].nlargest(10).sum())`,
      },
    ],
  },

  {
    id: "eda-corr",
    title: "광고비-판매 상관 분석",
    category: "탐색적 데이터 분석",
    level: 1,
    tags: ["describe", "pearson", "spearman"],
    intro: "채널별 광고비와 판매액의 기초 통계·상관관계를 pearson과 spearman으로 살펴봅니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(13)
n = 100
tv = rng.uniform(10, 300, n).round(1)
radio = rng.uniform(0, 50, n).round(1)
social = rng.uniform(0, 80, n).round(1)
sales = (5 + 0.05 * tv + 0.15 * radio + 0.02 * social + rng.normal(0, 2, n)).round(2)
df = pd.DataFrame({"tv": tv, "radio": radio, "social": social, "sales": sales})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "기초 통계량",
        prompt: "`tv`의 평균을 `mean_tv`에, `radio`의 표본표준편차(pandas 기본, ddof=1)를 `std_radio`에 담으세요.",
        expect: ["mean_tv", "std_radio"],
        hint: "df['tv'].mean(), df['radio'].std()",
        solution: String.raw`mean_tv = float(df["tv"].mean())
std_radio = float(df["radio"].std())`,
      },
      {
        id: "s2",
        title: "pearson 상관",
        prompt: "상관행렬에서 `sales`와 상관(절댓값 기준)이 가장 높은 설명변수 이름을 `best_var`에, 그 상관계수를 `best_corr`에 담으세요.",
        expect: ["best_var", "best_corr"],
        hint: "df.corr()['sales'].drop('sales') 에서 abs().idxmax()",
        solution: String.raw`c = df.corr()["sales"].drop("sales")
best_var = c.abs().idxmax()
best_corr = float(c[best_var])`,
      },
      {
        id: "s3",
        title: "spearman과 비교",
        prompt: "`tv`와 `sales`의 spearman 상관을 `sp_corr`에 담고, pearson 상관과의 차이 절댓값을 `diff_abs`에 담으세요.",
        expect: ["sp_corr", "diff_abs"],
        hint: "Series.corr(other, method='spearman')",
        solution: String.raw`sp_corr = float(df["tv"].corr(df["sales"], method="spearman"))
pe_corr = float(df["tv"].corr(df["sales"]))
diff_abs = abs(sp_corr - pe_corr)`,
      },
    ],
  },

  {
    id: "prob-dist",
    title: "확률 분포와 표본추출",
    category: "확률과 분포",
    level: 2,
    tags: ["norm", "binom", "sample"],
    intro: "정규분포·이항분포의 확률을 scipy.stats로 계산하고, 고정 시드로 표본을 추출합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(17)
df = pd.DataFrame({"height": rng.normal(170, 6, 500).round(1)})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "정규분포 확률",
        prompt: "키가 평균 170, 표준편차 6인 정규분포를 따를 때 ① 180cm를 **초과**할 확률을 `p_over` ② 상위 5% 경계값(95백분위수)을 `q95`에 담으세요.",
        expect: ["p_over", "q95"],
        hint: "scipy.stats.norm.sf(180, 170, 6), norm.ppf(0.95, 170, 6)",
        solution: String.raw`from scipy import stats
p_over = float(stats.norm.sf(180, 170, 6))
q95 = float(stats.norm.ppf(0.95, 170, 6))`,
      },
      {
        id: "s2",
        title: "이항분포 확률",
        prompt: "성공확률 0.3인 시행을 20번 할 때 ① 정확히 5번 성공할 확률 `p_eq5` ② 3번 이하로 성공할 확률 `p_le3`를 담으세요.",
        expect: ["p_eq5", "p_le3"],
        hint: "stats.binom.pmf(5, 20, 0.3), stats.binom.cdf(3, 20, 0.3)",
        solution: String.raw`p_eq5 = float(stats.binom.pmf(5, 20, 0.3))
p_le3 = float(stats.binom.cdf(3, 20, 0.3))`,
      },
      {
        id: "s3",
        title: "표본추출",
        prompt: "`df['height']`에서 `sample(n=50, random_state=42)`로 비복원 추출한 표본평균을 `sample_mean`에, 모평균(전체 평균)과의 차이 절댓값을 `diff_pop`에 담으세요.",
        expect: ["sample_mean", "diff_pop"],
        hint: "random_state를 반드시 42로",
        solution: String.raw`sample_mean = float(df["height"].sample(n=50, random_state=42).mean())
diff_pop = abs(sample_mean - float(df["height"].mean()))`,
      },
    ],
  },

  {
    id: "hypothesis",
    title: "가설검정 3종",
    category: "추정과 검정",
    level: 2,
    tags: ["ttest", "chi2", "crosstab"],
    intro: "단일표본 t검정, 독립표본 t검정, 카이제곱 독립성 검정을 수행합니다. 유의수준은 0.05.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(23)
score_a = rng.normal(72, 8, 40).round(1)
score_b = rng.normal(76, 7, 35).round(1)
df_score = pd.DataFrame({
    "group": ["A"] * 40 + ["B"] * 35,
    "score": np.concatenate([score_a, score_b]),
})
gender = rng.choice(["M", "F"], 200)
p_buy = np.where(gender == "F", 0.55, 0.35)
df_cat = pd.DataFrame({
    "gender": gender,
    "purchase": np.where(rng.random(200) < p_buy, "yes", "no"),
})
df_score.head()`,
    steps: [
      {
        id: "s1",
        title: "단일표본 t검정",
        prompt: "A그룹 점수의 모평균이 70인지 검정하세요. 통계량을 `t_stat`, p값을 `p_val`, 유의수준 0.05에서 귀무가설 기각 여부(True/False)를 `reject`에 담으세요.",
        expect: ["t_stat", "p_val", "reject"],
        hint: "scipy.stats.ttest_1samp(a_scores, 70)",
        solution: String.raw`from scipy import stats
a_scores = df_score.loc[df_score["group"] == "A", "score"]
res1 = stats.ttest_1samp(a_scores, 70)
t_stat = float(res1.statistic)
p_val = float(res1.pvalue)
reject = bool(p_val < 0.05)`,
      },
      {
        id: "s2",
        title: "독립표본 t검정",
        prompt: "A·B 두 그룹 평균이 같은지 `equal_var=True`(등분산 가정)로 검정하세요. 통계량 `t2`, p값 `p2`, 기각 여부 `reject2`.",
        expect: ["t2", "p2", "reject2"],
        hint: "stats.ttest_ind(a, b, equal_var=True)",
        solution: String.raw`b_scores = df_score.loc[df_score["group"] == "B", "score"]
res2 = stats.ttest_ind(a_scores, b_scores, equal_var=True)
t2 = float(res2.statistic)
p2 = float(res2.pvalue)
reject2 = bool(p2 < 0.05)`,
      },
      {
        id: "s3",
        title: "카이제곱 독립성 검정",
        prompt: "`df_cat`에서 성별과 구매여부의 교차표를 `pd.crosstab`으로 만들고 카이제곱 독립성 검정을 하세요. 통계량 `chi2`, p값 `p_chi`, 자유도 `dof`.",
        expect: ["chi2", "p_chi", "dof"],
        hint: "stats.chi2_contingency(pd.crosstab(...)) — 반환 순서는 (통계량, p, 자유도, 기대빈도)",
        solution: String.raw`table = pd.crosstab(df_cat["gender"], df_cat["purchase"])
chi2_res = stats.chi2_contingency(table)
chi2 = float(chi2_res[0])
p_chi = float(chi2_res[1])
dof = int(chi2_res[2])`,
      },
    ],
  },

  {
    id: "timeseries",
    title: "월별 매출 시계열 분해·평활",
    category: "시계열 분석",
    level: 3,
    tags: ["rolling", "seasonal_decompose", "ExponentialSmoothing"],
    intro: "5년 월별 매출을 이동평균, 가법 분해, 지수평활(단순·홀트윈터스)로 분석합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(31)
idx = pd.date_range("2019-01-01", periods=60, freq="MS")
trend = np.linspace(100, 160, 60)
season = 12 * np.sin(2 * np.pi * (np.arange(60) % 12) / 12)
s = pd.Series((trend + season + rng.normal(0, 3, 60)).round(2), index=idx, name="sales")
s.head()`,
    steps: [
      {
        id: "s1",
        title: "이동평균",
        prompt: "창 크기 12의 이동평균 `ma12 = s.rolling(window=12).mean()`을 만들고, 마지막 값을 `last_ma`, 결측이 아닌 값의 개수를 `n_valid`에 담으세요.",
        expect: ["last_ma", "n_valid"],
        hint: "ma12.iloc[-1], ma12.notna().sum()",
        solution: String.raw`ma12 = s.rolling(window=12).mean()
last_ma = float(ma12.iloc[-1])
n_valid = int(ma12.notna().sum())`,
      },
      {
        id: "s2",
        title: "가법 분해",
        prompt: "`seasonal_decompose(s, model='additive', period=12)`로 분해해 계절 성분의 최댓값을 `seas_max`, 추세 성분의 (결측 제외) 마지막 값을 `trend_last`에 담으세요.",
        expect: ["seas_max", "trend_last"],
        hint: "from statsmodels.tsa.seasonal import seasonal_decompose",
        solution: String.raw`from statsmodels.tsa.seasonal import seasonal_decompose
dec = seasonal_decompose(s, model="additive", period=12)
seas_max = float(dec.seasonal.max())
trend_last = float(dec.trend.dropna().iloc[-1])`,
      },
      {
        id: "s3",
        title: "지수평활",
        prompt: "① `SimpleExpSmoothing(s, initialization_method='heuristic')`을 `fit(smoothing_level=0.3, optimized=False)`로 적합해 1개월 예측값을 `pred1`에 ② `ExponentialSmoothing(s, trend='add', seasonal='add', seasonal_periods=12, initialization_method='estimated')`을 `fit()`으로 적합해 12개월 예측 합을 `fc_sum`에 담으세요.",
        expect: ["pred1", "fc_sum"],
        hint: "forecast(1).iloc[0], forecast(12).sum()",
        solution: String.raw`from statsmodels.tsa.holtwinters import SimpleExpSmoothing, ExponentialSmoothing
ses = SimpleExpSmoothing(s, initialization_method="heuristic").fit(smoothing_level=0.3, optimized=False)
pred1 = float(ses.forecast(1).iloc[0])
hw = ExponentialSmoothing(s, trend="add", seasonal="add", seasonal_periods=12,
                          initialization_method="estimated").fit()
fc_sum = float(hw.forecast(12).sum())`,
      },
    ],
  },

  {
    id: "regression",
    title: "판매량 회귀 3종 비교",
    category: "회귀",
    level: 2,
    tags: ["LinearRegression", "RMSE", "MAPE", "DecisionTree", "KNN"],
    intro: "선형회귀·의사결정나무·KNN 회귀를 학습하고 R², Adjusted R², RMSE, MAE, MAPE로 평가합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(41)
n = 250
temp = rng.uniform(5, 33, n).round(1)
humid = rng.uniform(30, 90, n).round(1)
wind = rng.uniform(0, 8, n).round(1)
ads = rng.uniform(0, 100, n).round(1)
count = (250 + 8 * temp - 1.2 * humid + 3 * wind + 0.5 * ads + rng.normal(0, 18, n)).round(0)
df = pd.DataFrame({"temp": temp, "humid": humid, "wind": wind, "ads": ads, "count": count})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "탐색과 분할",
        prompt: "① `count`와 상관(절댓값)이 가장 높은 설명변수 이름을 `best_feat`에 ② `X = df[['temp','humid','wind','ads']]`, `y = df['count']`를 `train_test_split(test_size=0.3, random_state=42)`로 나눠 `X_train, X_test, y_train, y_test`를 만들고 크기를 `n_train`, `n_test`에 담으세요.",
        expect: ["best_feat", "n_train", "n_test"],
        hint: "df.corr()['count'].drop('count').abs().idxmax()",
        solution: String.raw`from sklearn.model_selection import train_test_split
best_feat = df.corr()["count"].drop("count").abs().idxmax()
X = df[["temp", "humid", "wind", "ads"]]
y = df["count"]
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)
n_train = len(X_train)
n_test = len(X_test)`,
      },
      {
        id: "s2",
        title: "선형회귀와 평가지표",
        prompt: "`LinearRegression`을 학습하고 테스트셋 예측으로 `r2`, `rmse`(=`np.sqrt(mean_squared_error)`), `mae`, `mape`(`mean_absolute_percentage_error`), `adj_r2`(= `1-(1-r2)*(n-1)/(n-p-1)`, n=테스트 행 수, p=설명변수 4)를 계산하세요.",
        expect: ["r2", "rmse", "mae", "mape", "adj_r2"],
        hint: "sklearn.metrics의 r2_score, mean_squared_error, mean_absolute_error, mean_absolute_percentage_error",
        solution: String.raw`from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error, mean_absolute_percentage_error
lr = LinearRegression().fit(X_train, y_train)
pred = lr.predict(X_test)
r2 = float(r2_score(y_test, pred))
rmse = float(np.sqrt(mean_squared_error(y_test, pred)))
mae = float(mean_absolute_error(y_test, pred))
mape = float(mean_absolute_percentage_error(y_test, pred))
n_t = len(y_test)
adj_r2 = 1 - (1 - r2) * (n_t - 1) / (n_t - 4 - 1)`,
      },
      {
        id: "s3",
        title: "트리·KNN 회귀 비교",
        prompt: "`DecisionTreeRegressor(max_depth=4, random_state=42)`와 `KNeighborsRegressor(n_neighbors=5)`를 학습해 테스트 RMSE를 각각 `rmse_dt`, `rmse_knn`에 담고, 더 낮은 쪽 이름(`'tree'` 또는 `'knn'`)을 `best_model`에 담으세요.",
        expect: ["rmse_dt", "rmse_knn", "best_model"],
        hint: "np.sqrt(mean_squared_error(...)) 재사용",
        solution: String.raw`from sklearn.tree import DecisionTreeRegressor
from sklearn.neighbors import KNeighborsRegressor
dt = DecisionTreeRegressor(max_depth=4, random_state=42).fit(X_train, y_train)
knn = KNeighborsRegressor(n_neighbors=5).fit(X_train, y_train)
rmse_dt = float(np.sqrt(mean_squared_error(y_test, dt.predict(X_test))))
rmse_knn = float(np.sqrt(mean_squared_error(y_test, knn.predict(X_test))))
best_model = "tree" if rmse_dt < rmse_knn else "knn"`,
      },
    ],
  },

  {
    id: "classification",
    title: "고객 이탈 분류 4종",
    category: "분류",
    level: 3,
    tags: ["LogisticRegression", "DecisionTree", "NaiveBayes", "KNN"],
    intro: "로지스틱 회귀·의사결정나무·나이브베이즈·KNN으로 이탈을 예측하고 정확도/정밀도/재현율을 비교합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(43)
n = 300
age = rng.integers(20, 65, n)
balance = rng.normal(5000, 2000, n).round(0)
visits = rng.integers(0, 30, n)
logit = 0.06 * (age - 40) + 0.0005 * (balance - 5000) + 0.15 * (visits - 15) + rng.normal(0, 1, n)
df = pd.DataFrame({"age": age, "balance": balance, "visits": visits,
                   "churn": (logit > 0).astype(int)})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "스케일링과 분할",
        prompt: "`X = df[['age','balance','visits']]`를 `StandardScaler`로 표준화한 배열 `X_scaled`를 만들고, `y = df['churn']`과 함께 `train_test_split(test_size=0.3, random_state=42, stratify=y)`로 나누세요(`X_train, X_test, y_train, y_test`). 학습 데이터 크기 `n_train`, 학습 데이터의 이탈(1) 비율 `pos_rate`.",
        expect: ["n_train", "pos_rate"],
        hint: "stratify=y를 잊지 마세요",
        solution: String.raw`from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
feat_names = ["age", "balance", "visits"]
X = df[feat_names]
y = df["churn"]
X_scaled = StandardScaler().fit_transform(X)
X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.3, random_state=42, stratify=y)
n_train = len(X_train)
pos_rate = float(y_train.mean())`,
      },
      {
        id: "s2",
        title: "로지스틱 회귀",
        prompt: "`LogisticRegression(max_iter=1000)`을 학습해 테스트 `acc`(정확도), `prec`(정밀도), `rec`(재현율)을 구하고, 회귀계수 절댓값이 가장 큰 변수 이름(`age/balance/visits`)을 `top_feat`에 담으세요.",
        expect: ["acc", "prec", "rec", "top_feat"],
        hint: "accuracy_score, precision_score, recall_score / coef_[0]",
        solution: String.raw`from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score
logreg = LogisticRegression(max_iter=1000).fit(X_train, y_train)
pred_lr = logreg.predict(X_test)
acc = float(accuracy_score(y_test, pred_lr))
prec = float(precision_score(y_test, pred_lr))
rec = float(recall_score(y_test, pred_lr))
top_feat = feat_names[int(np.argmax(np.abs(logreg.coef_[0])))]`,
      },
      {
        id: "s3",
        title: "트리·NB·KNN 비교",
        prompt: "`DecisionTreeClassifier(max_depth=3, random_state=42)`의 테스트 정확도 `acc_dt`와 중요도 최대 변수 `imp_feat`, `GaussianNB` 정확도 `acc_nb`, `KNeighborsClassifier(n_neighbors=5)` 정확도 `acc_knn`을 구하세요.",
        expect: ["acc_dt", "imp_feat", "acc_nb", "acc_knn"],
        hint: "feature_importances_ 의 argmax를 feat_names로 변환",
        solution: String.raw`from sklearn.tree import DecisionTreeClassifier
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
dtc = DecisionTreeClassifier(max_depth=3, random_state=42).fit(X_train, y_train)
acc_dt = float(accuracy_score(y_test, dtc.predict(X_test)))
imp_feat = feat_names[int(np.argmax(dtc.feature_importances_))]
acc_nb = float(accuracy_score(y_test, GaussianNB().fit(X_train, y_train).predict(X_test)))
acc_knn = float(accuracy_score(y_test, KNeighborsClassifier(n_neighbors=5).fit(X_train, y_train).predict(X_test)))`,
      },
    ],
  },

  {
    id: "clustering",
    title: "고객 세분화 k-means",
    category: "군집",
    level: 2,
    tags: ["KMeans", "silhouette", "cluster_centers_"],
    intro: "소득·소비점수·나이를 표준화해 k-means로 군집화하고 실루엣 계수와 군집중심거리를 계산합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(47)
income = np.concatenate([rng.normal(40, 6, 60), rng.normal(70, 7, 60), rng.normal(100, 8, 60)])
spending = np.concatenate([rng.normal(60, 8, 60), rng.normal(30, 6, 60), rng.normal(80, 7, 60)])
age = rng.uniform(20, 60, 180)
df = pd.DataFrame({"income": income.round(1), "spending": spending.round(1), "age": age.round(0)})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "표준화",
        prompt: "세 변수 전체를 `StandardScaler`로 표준화한 배열을 `X_scaled`에 담으세요.",
        expect: ["X_scaled"],
        hint: "StandardScaler().fit_transform(df)",
        solution: String.raw`from sklearn.preprocessing import StandardScaler
X_scaled = StandardScaler().fit_transform(df)`,
      },
      {
        id: "s2",
        title: "k-means와 실루엣",
        prompt: "`KMeans(n_clusters=3, random_state=42, n_init=10)`으로 군집화해 라벨을 `labels`에 저장하고, 군집 크기를 **내림차순 정렬한 리스트** `sizes`와 실루엣 계수 `sil`을 구하세요.",
        expect: ["sizes", "sil"],
        hint: "np.bincount(labels), silhouette_score(X_scaled, labels)",
        solution: String.raw`from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
km = KMeans(n_clusters=3, random_state=42, n_init=10).fit(X_scaled)
labels = km.labels_
sizes = sorted((int(v) for v in np.bincount(labels)), reverse=True)
sil = float(silhouette_score(X_scaled, labels))`,
      },
      {
        id: "s3",
        title: "군집중심거리",
        prompt: "각 점과 자기 군집 중심 사이 유클리드 거리의 평균을 `mean_dist`에, 관성(`inertia_`)을 `inertia`에 담으세요.",
        expect: ["mean_dist", "inertia"],
        hint: "np.linalg.norm(X_scaled - km.cluster_centers_[labels], axis=1)",
        solution: String.raw`dists = np.linalg.norm(X_scaled - km.cluster_centers_[labels], axis=1)
mean_dist = float(dists.mean())
inertia = float(km.inertia_)`,
      },
    ],
  },

  {
    id: "feature-vif",
    title: "다중공선성과 피처 선택",
    category: "피처 선택",
    level: 3,
    tags: ["VIF", "corr", "LinearRegression"],
    intro: "상관·VIF로 다중공선성을 진단하고, 변수를 덜어낸 모델과 성능을 비교합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(53)
n = 200
x1 = rng.normal(50, 10, n)
x2 = x1 * 0.9 + rng.normal(0, 3, n)
x3 = rng.normal(30, 5, n)
x4 = x3 * 0.5 + rng.normal(0, 4, n)
y = 2 * x1 + 1.5 * x3 + rng.normal(0, 8, n)
df = pd.DataFrame({"x1": x1, "x2": x2, "x3": x3, "x4": x4, "y": y}).round(3)
df.head()`,
    steps: [
      {
        id: "s1",
        title: "상관 기반 진단",
        prompt: "설명변수 `x1~x4` 상관행렬에서 |상관| > 0.8 인 서로 다른 변수 쌍의 개수를 `n_high_pairs`에 담으세요.",
        expect: ["n_high_pairs"],
        hint: "상관행렬 상삼각(또는 이중 반복에서 i<j)만 세기",
        solution: String.raw`feats = ["x1", "x2", "x3", "x4"]
cm = df[feats].corr()
n_high_pairs = 0
for i in range(len(feats)):
    for j in range(i + 1, len(feats)):
        if abs(cm.iloc[i, j]) > 0.8:
            n_high_pairs += 1`,
      },
      {
        id: "s2",
        title: "VIF 계산",
        prompt: "상수항을 추가(`add_constant`)한 뒤 `variance_inflation_factor`로 각 설명변수의 VIF를 구하세요(const 제외). VIF 최대 변수 이름을 `worst_var`, 그 값을 `worst_vif`에 담으세요.",
        expect: ["worst_var", "worst_vif"],
        hint: "from statsmodels.stats.outliers_influence import variance_inflation_factor",
        solution: String.raw`from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.tools.tools import add_constant
Xc = add_constant(df[feats])
vifs = {col: float(variance_inflation_factor(Xc.values, i))
        for i, col in enumerate(Xc.columns) if col != "const"}
worst_var = max(vifs, key=vifs.get)
worst_vif = vifs[worst_var]`,
      },
      {
        id: "s3",
        title: "제거 후 비교",
        prompt: "① `worst_var`를 제거하고 VIF를 다시 계산해 최댓값을 `max_vif_after`에 ② 전체 4변수 선형회귀의 학습 R²(`score`)을 `r2_full`, 제거 후 3변수 R²을 `r2_reduced`에 담으세요.",
        expect: ["max_vif_after", "r2_full", "r2_reduced"],
        hint: "LinearRegression().fit(X, df['y']).score(X, df['y'])",
        solution: String.raw`from sklearn.linear_model import LinearRegression
kept = [f for f in feats if f != worst_var]
Xc2 = add_constant(df[kept])
vifs2 = {col: float(variance_inflation_factor(Xc2.values, i))
         for i, col in enumerate(Xc2.columns) if col != "const"}
max_vif_after = max(vifs2.values())
r2_full = float(LinearRegression().fit(df[feats], df["y"]).score(df[feats], df["y"]))
r2_reduced = float(LinearRegression().fit(df[kept], df["y"]).score(df[kept], df["y"]))`,
      },
    ],
  },

  {
    id: "strings",
    title: "주문 코드 문자열 전처리",
    category: "문자열 전처리",
    level: 1,
    tags: ["str.split", "str.extract", "정규식"],
    intro: "주문 코드·이메일·상품명 문자열을 분해·추출·정제합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(59)
n = 120
regions = rng.choice(["SEOUL", "BUSAN", "DAEJEON", "JEJU"], n, p=[0.45, 0.25, 0.2, 0.1])
nums = rng.choice(np.arange(1, 5000), n, replace=False)
domains = rng.choice(["gmail.com", "naver.com", "daum.net"], n)
products = rng.choice(["  Americano ", "americano", "Cafe_Latte", " cafe_latte", "COOKIE", "cookie  "], n)
df = pd.DataFrame({
    "code": [f"ORD-2024-{v:04d}_{r}" for v, r in zip(nums, regions)],
    "email": [f"user{i}@{d}" for i, d in enumerate(domains, start=1)],
    "product": products,
})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "구분자 분리",
        prompt: "`code`를 `_`로 나눠 지역을 `region` 컬럼으로 만들고, 최다 지역 이름을 `top_region`, 그 건수를 `top_count`에 담으세요.",
        expect: ["top_region", "top_count"],
        hint: "df['code'].str.split('_').str[1], value_counts()",
        solution: String.raw`df["region"] = df["code"].str.split("_").str[1]
counts = df["region"].value_counts()
top_region = counts.idxmax()
top_count = int(counts.max())`,
      },
      {
        id: "s2",
        title: "정규식 추출",
        prompt: "① 정규식으로 주문번호 4자리를 뽑아 정수형 `ord_no` 컬럼을 만들고 최댓값을 `max_ord`에 ② 이메일 도메인의 고유 개수를 `n_domains`에 담으세요.",
        expect: ["max_ord", "n_domains"],
        hint: "str.extract(r'ORD-2024-(\\d{4})', expand=False).astype(int)",
        solution: String.raw`df["ord_no"] = df["code"].str.extract(r"ORD-2024-(\d{4})", expand=False).astype(int)
max_ord = int(df["ord_no"].max())
n_domains = int(df["email"].str.split("@").str[1].nunique())`,
      },
      {
        id: "s3",
        title: "표기 정제",
        prompt: "`product`를 공백 제거(strip)·소문자화·`_` 삭제로 정제해 고유 상품 수를 `n_products`에, 최다 상품명을 `top_product`에 담으세요.",
        expect: ["n_products", "top_product"],
        hint: "str.strip().str.lower().str.replace('_', '', regex=False)",
        solution: String.raw`clean = df["product"].str.strip().str.lower().str.replace("_", "", regex=False)
n_products = int(clean.nunique())
top_product = clean.value_counts().idxmax()`,
      },
    ],
  },

  {
    id: "assoc-rules",
    title: "장바구니 연관규칙",
    category: "연관규칙",
    level: 3,
    tags: ["support", "confidence", "lift"],
    intro: "거래 데이터에서 지지도·신뢰도·향상도를 직접 계산합니다. (외부 라이브러리 없이 pandas로)",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(61)
items_pool = ["커피", "쿠키", "샌드위치", "주스", "케이크"]
transactions = []
for i in range(200):
    basket = set()
    if rng.random() < 0.6:
        basket.add("커피")
    if ("커피" in basket and rng.random() < 0.55) or rng.random() < 0.25:
        basket.add("쿠키")
    if rng.random() < 0.3:
        basket.add("샌드위치")
    if rng.random() < 0.25:
        basket.add("주스")
    if rng.random() < 0.15:
        basket.add("케이크")
    if not basket:
        basket.add(items_pool[int(rng.integers(0, 5))])
    transactions.append(sorted(basket))
df = pd.DataFrame({"tx_id": np.arange(1, 201), "items": transactions})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "아이템 지지도",
        prompt: "거래를 원핫 DataFrame `onehot`(아이템별 0/1, 컬럼 순서는 `items_pool` 순)으로 만들고, 지지도가 가장 높은 아이템을 `top_item`, 그 지지도를 `top_support`에 담으세요.",
        expect: ["top_item", "top_support"],
        hint: "pd.DataFrame([{it: 1 for it in tx} for tx in df['items']]).reindex(columns=items_pool).fillna(0).astype(int)",
        solution: String.raw`onehot = pd.DataFrame([{it: 1 for it in tx} for tx in df["items"]])
onehot = onehot.reindex(columns=items_pool).fillna(0).astype(int)
supports = onehot.mean()
top_item = supports.idxmax()
top_support = float(supports.max())`,
      },
      {
        id: "s2",
        title: "지지도와 신뢰도",
        prompt: "규칙 `커피 → 쿠키`에 대해 ① 두 아이템 동시 구매 지지도 `sup_ab` ② 신뢰도 `conf_a_to_b`(= sup_ab / 커피 지지도)를 계산하세요.",
        expect: ["sup_ab", "conf_a_to_b"],
        hint: "((onehot['커피'] == 1) & (onehot['쿠키'] == 1)).mean()",
        solution: String.raw`sup_a = float(onehot["커피"].mean())
sup_ab = float(((onehot["커피"] == 1) & (onehot["쿠키"] == 1)).mean())
conf_a_to_b = sup_ab / sup_a`,
      },
      {
        id: "s3",
        title: "향상도 판정",
        prompt: "향상도 `lift_ab`(= 신뢰도 / 쿠키 지지도)를 계산하고, 1보다 크면(양의 연관) `assoc = True`, 아니면 `False`로 담으세요.",
        expect: ["lift_ab", "assoc"],
        hint: "lift = conf_a_to_b / onehot['쿠키'].mean()",
        solution: String.raw`sup_b = float(onehot["쿠키"].mean())
lift_ab = conf_a_to_b / sup_b
assoc = bool(lift_ab > 1)`,
      },
    ],
  },
];
