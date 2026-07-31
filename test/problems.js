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

  {
    id: "clean-dupes",
    title: "회원 명부 중복 정리",
    category: "데이터 클렌징",
    level: 2,
    tags: ["duplicated", "drop_duplicates", "transform"],
    intro: "중복 등록된 회원 명부를 정리하고, 그룹별 평균으로 결측을 대치한 뒤 조건 필터링합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(71)
n = 150
df = pd.DataFrame({
    "member_id": rng.choice(np.arange(1000, 1100), n),
    "plan": rng.choice(["basic", "pro", "enterprise"], n, p=[0.5, 0.35, 0.15]),
    "age": rng.integers(18, 70, n).astype(float),
    "monthly_fee": rng.choice([9900.0, 19900.0, 49900.0], n),
})
df.loc[rng.choice(n, 10, replace=False), "age"] = np.nan
df.head()`,
    steps: [
      {
        id: "s1",
        title: "중복 진단",
        prompt: "`member_id` 기준으로 중복인 행 수(첫 등장 제외)를 `n_dup`에, 고유 회원 수를 `n_members`에 담으세요.",
        expect: ["n_dup", "n_members"],
        hint: "df.duplicated(subset=['member_id']).sum(), nunique()",
        solution: String.raw`n_dup = int(df.duplicated(subset=["member_id"]).sum())
n_members = int(df["member_id"].nunique())`,
      },
      {
        id: "s2",
        title: "중복 제거",
        prompt: "`member_id` 기준 **첫 등장만** 남긴 `df_u`를 만들고(`keep='first'`, `reset_index(drop=True)`), 행 수를 `n_rows_u`에 담으세요.",
        expect: ["df_u", "n_rows_u"],
        hint: "drop_duplicates(subset=['member_id'], keep='first')",
        solution: String.raw`df_u = df.drop_duplicates(subset=["member_id"], keep="first").reset_index(drop=True)
n_rows_u = len(df_u)`,
      },
      {
        id: "s3",
        title: "그룹 대치와 필터",
        prompt: "`df_u`의 `age` 결측을 **plan별 평균**으로 대치한 뒤 전체 평균을 `age_mean`에, `pro` 플랜이면서 `age >= 40`인 회원 수를 `n_pro40`에 담으세요.",
        expect: ["age_mean", "n_pro40"],
        hint: "groupby('plan')['age'].transform(lambda s: s.fillna(s.mean()))",
        solution: String.raw`df_u["age"] = df_u.groupby("plan")["age"].transform(lambda s: s.fillna(s.mean()))
age_mean = float(df_u["age"].mean())
n_pro40 = int(((df_u["plan"] == "pro") & (df_u["age"] >= 40)).sum())`,
      },
    ],
  },

  {
    id: "merge-join",
    title: "주문·고객 테이블 병합",
    category: "피처 엔지니어링",
    level: 2,
    tags: ["merge", "isin", "fillna"],
    intro: "주문 로그와 고객 명부를 merge로 결합합니다. 명부에 없는 주문(비회원)도 존재합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(73)
customers = pd.DataFrame({
    "cust_id": np.arange(1, 41),
    "grade": rng.choice(["silver", "gold", "vip"], 40, p=[0.5, 0.35, 0.15]),
    "city": rng.choice(["서울", "부산", "대구"], 40),
})
orders = pd.DataFrame({
    "order_id": np.arange(1, 201),
    "cust_id": rng.integers(1, 51, 200),
    "amount": rng.integers(10, 200, 200) * 1000,
})
orders.head()`,
    steps: [
      {
        id: "s1",
        title: "inner 병합",
        prompt: "두 테이블을 `cust_id` 기준 **inner** merge한 `df_m`을 만들고 행 수를 `n_matched`에, 고객 명부에 **없는** 주문 수를 `n_orphan`에 담으세요.",
        expect: ["n_matched", "n_orphan"],
        hint: "~orders['cust_id'].isin(customers['cust_id'])",
        solution: String.raw`df_m = orders.merge(customers, on="cust_id", how="inner")
n_matched = len(df_m)
n_orphan = int((~orders["cust_id"].isin(customers["cust_id"])).sum())`,
      },
      {
        id: "s2",
        title: "left 병합과 대치",
        prompt: "**left** merge 후 `grade` 결측을 `'guest'`로 대치하고, 등급별 주문 **건수**를 내림차순 Series `cnt_by_grade`에 담으세요.",
        expect: ["cnt_by_grade"],
        hint: "value_counts()는 기본이 내림차순입니다",
        solution: String.raw`df_l = orders.merge(customers, on="cust_id", how="left")
df_l["grade"] = df_l["grade"].fillna("guest")
cnt_by_grade = df_l["grade"].value_counts()`,
      },
      {
        id: "s3",
        title: "집계 후 조인",
        prompt: "고객별 총 주문금액을 집계해 `customers`에 left 조인(주문 없으면 0)하세요. **명부에 있는 고객 중** 총액 1위의 `cust_id`를 `top_cust`(int)에, vip 고객들의 총액 합을 `vip_total`에 담으세요.",
        expect: ["top_cust", "vip_total"],
        hint: "orders.groupby('cust_id')['amount'].sum() 을 merge 후 fillna(0)",
        solution: String.raw`totals = orders.groupby("cust_id")["amount"].sum()
cust2 = customers.merge(totals.rename("total"), how="left", left_on="cust_id", right_index=True)
cust2["total"] = cust2["total"].fillna(0)
top_cust = int(cust2.loc[cust2["total"].idxmax(), "cust_id"])
vip_total = float(cust2.loc[cust2["grade"] == "vip", "total"].sum())`,
      },
    ],
  },

  {
    id: "pivot-melt",
    title: "매출표 피벗과 melt",
    category: "변환·스케일링",
    level: 2,
    tags: ["pivot_table", "melt", "crosstab"],
    intro: "long 형태의 지점×월 매출을 wide로 피벗했다가 다시 long으로 되돌리고, 비율 교차표를 만듭니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(79)
months = ["1월", "2월", "3월", "4월"]
branches = ["강남", "홍대", "판교"]
rows = [(b, m, float(rng.integers(50, 200) * 10)) for b in branches for m in months]
df = pd.DataFrame(rows, columns=["branch", "month", "sales"])
extra = pd.DataFrame([("강남", "1월", 1300.0), ("판교", "3월", 900.0)],
                     columns=["branch", "month", "sales"])
df = pd.concat([df, extra], ignore_index=True)
df.head()`,
    steps: [
      {
        id: "s1",
        title: "wide 피벗",
        prompt: "`pivot_table(index='branch', columns='month', values='sales', aggfunc='mean')`으로 `wide`를 만드세요(중복 기록은 평균 처리됨). 강남 1월 값을 `gn_jan`에, 셀 개수(`wide.size`)를 `n_cells`에 담으세요.",
        expect: ["gn_jan", "n_cells"],
        hint: "wide.loc['강남', '1월']",
        solution: String.raw`wide = df.pivot_table(index="branch", columns="month", values="sales", aggfunc="mean")
gn_jan = float(wide.loc["강남", "1월"])
n_cells = int(wide.size)`,
      },
      {
        id: "s2",
        title: "다시 long으로",
        prompt: "`wide.reset_index()`를 `melt(id_vars='branch', var_name='month', value_name='sales')`로 long 형태 `long_df`로 되돌리세요. 행 수를 `n_long`에, 홍대 4월 값을 `hd_apr`에 담으세요.",
        expect: ["n_long", "hd_apr"],
        hint: "long_df에서 불리언 인덱싱으로 홍대·4월 행을 찾으세요",
        solution: String.raw`long_df = wide.reset_index().melt(id_vars="branch", var_name="month", value_name="sales")
n_long = len(long_df)
hd_apr = float(long_df.loc[(long_df["branch"] == "홍대") & (long_df["month"] == "4월"), "sales"].iloc[0])`,
      },
      {
        id: "s3",
        title: "비율 교차표",
        prompt: "원본 `df`로 `pd.crosstab(df['branch'], df['month'], values=df['sales'], aggfunc='sum', normalize='index')`를 만들어, 강남 행에서 비중이 가장 큰 월을 `gn_top_month`에, 그 비율을 `gn_top_ratio`에 담으세요.",
        expect: ["gn_top_month", "gn_top_ratio"],
        hint: "ct.loc['강남'].idxmax(), ct.loc['강남'].max()",
        solution: String.raw`ct = pd.crosstab(df["branch"], df["month"], values=df["sales"], aggfunc="sum", normalize="index")
gn_top_month = ct.loc["강남"].idxmax()
gn_top_ratio = float(ct.loc["강남"].max())`,
      },
    ],
  },

  {
    id: "eda-group",
    title: "편의점 그룹 집계 심화",
    category: "탐색적 데이터 분석",
    level: 2,
    tags: ["agg", "transform", "idxmax"],
    intro: "지점·카테고리별 매출을 다중 집계하고, 행 단위 비중과 지점별 1위 카테고리를 구합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(83)
n = 300
df = pd.DataFrame({
    "store": rng.choice(["A", "B", "C", "D"], n),
    "category": rng.choice(["음료", "스낵", "도시락", "생활용품"], n, p=[0.35, 0.3, 0.2, 0.15]),
    "sales": rng.integers(1, 50, n) * 100,
})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "다중 집계",
        prompt: "지점별 `sales`의 합·평균·건수를 담은 DataFrame `stats_df`(`agg(['sum', 'mean', 'count'])`)를 만들고, 합계가 가장 큰 지점을 `best_store`에 담으세요.",
        expect: ["stats_df", "best_store"],
        hint: "stats_df['sum'].idxmax()",
        solution: String.raw`stats_df = df.groupby("store")["sales"].agg(["sum", "mean", "count"])
best_store = stats_df["sum"].idxmax()`,
      },
      {
        id: "s2",
        title: "행 단위 비중",
        prompt: "`transform`으로 각 행의 매출이 자기 지점 총매출에서 차지하는 비중 `share` 컬럼을 만들고, 그 최댓값을 `max_share`에 담으세요.",
        expect: ["max_share"],
        hint: "df['sales'] / df.groupby('store')['sales'].transform('sum')",
        solution: String.raw`df["share"] = df["sales"] / df.groupby("store")["sales"].transform("sum")
max_share = float(df["share"].max())`,
      },
      {
        id: "s3",
        title: "지점별 1위 카테고리",
        prompt: "지점×카테고리 매출 합계 피벗(`fill_value=0`)에서 지점별 1위 카테고리 Series `top_cat`(`idxmax(axis=1)`)을 만들고, D 지점의 음료 매출 합을 `d_bev`에 담으세요.",
        expect: ["top_cat", "d_bev"],
        hint: "pivot_table(..., aggfunc='sum', fill_value=0)",
        solution: String.raw`pv = df.pivot_table(index="store", columns="category", values="sales", aggfunc="sum", fill_value=0)
top_cat = pv.idxmax(axis=1)
d_bev = float(pv.loc["D", "음료"])`,
      },
    ],
  },

  {
    id: "strings-regex",
    title: "웹 로그 정규식 파싱",
    category: "문자열 전처리",
    level: 2,
    tags: ["extract", "contains", "정규식"],
    intro: "접속 로그 문자열에서 IP·페이지·상태코드·지연시간을 정규식으로 뽑아 분석합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(89)
n = 150
ips = [f"192.168.{int(a)}.{int(b)}" for a, b in zip(rng.integers(0, 5, n), rng.integers(1, 255, n))]
pages = rng.choice(["/home", "/items/", "/items/view", "/cart", "/checkout"], n, p=[0.3, 0.2, 0.2, 0.2, 0.1])
codes = rng.choice([200, 200, 200, 404, 500], n)
ms = rng.integers(10, 900, n)
df = pd.DataFrame({"log": [f"{ip} GET {pg} {c} {m}ms" for ip, pg, c, m in zip(ips, pages, codes, ms)]})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "다중 그룹 추출",
        prompt: "정규식 `^(\\S+) GET (\\S+) (\\d{3}) (\\d+)ms$` 로 `ip, page, status, latency` 컬럼을 만들고(`status`·`latency`는 정수형), 에러(상태코드 400 이상) 수를 `n_error`에, 평균 지연을 `mean_latency`에 담으세요.",
        expect: ["n_error", "mean_latency"],
        hint: "df['log'].str.extract(...) 는 그룹 수만큼 컬럼을 돌려줍니다",
        solution: String.raw`parts = df["log"].str.extract(r"^(\S+) GET (\S+) (\d{3}) (\d+)ms$")
parts.columns = ["ip", "page", "status", "latency"]
df[["ip", "page"]] = parts[["ip", "page"]]
df["status"] = parts["status"].astype(int)
df["latency"] = parts["latency"].astype(int)
n_error = int((df["status"] >= 400).sum())
mean_latency = float(df["latency"].mean())`,
      },
      {
        id: "s2",
        title: "포함 검색과 부분 추출",
        prompt: "`page`에 `items`가 포함된 요청 수를 `n_items`에, `ip`의 **마지막 옥텟**을 정수로 뽑아 최댓값을 `max_octet`에 담으세요.",
        expect: ["n_items", "max_octet"],
        hint: "str.contains('items'), str.extract(r'\\.(\\d+)$', expand=False)",
        solution: String.raw`n_items = int(df["page"].str.contains("items").sum())
max_octet = int(df["ip"].str.extract(r"\.(\d+)$", expand=False).astype(int).max())`,
      },
      {
        id: "s3",
        title: "상태코드별 지연",
        prompt: "상태코드별 평균 지연 Series `lat_by_status`(인덱스 오름차순 정렬)를 만들고, 500 에러의 평균 지연을 `lat_500`에 담으세요.",
        expect: ["lat_by_status", "lat_500"],
        hint: "groupby('status')['latency'].mean().sort_index()",
        solution: String.raw`lat_by_status = df.groupby("status")["latency"].mean().sort_index()
lat_500 = float(lat_by_status.loc[500])`,
      },
    ],
  },

  {
    id: "apply-derive",
    title: "BMI 구간화와 조건 파생",
    category: "피처 엔지니어링",
    level: 1,
    tags: ["cut", "np.where", "map"],
    intro: "키·몸무게로 BMI를 계산하고 pd.cut 구간화, map 인코딩으로 파생변수를 만듭니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(97)
n = 200
df = pd.DataFrame({
    "height_cm": rng.normal(168, 8, n).round(1),
    "weight_kg": rng.normal(65, 12, n).round(1),
    "smoker": rng.choice(["yes", "no"], n, p=[0.25, 0.75]),
})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "BMI 계산",
        prompt: "`bmi` 컬럼(= 몸무게kg ÷ (키m)², 반올림하지 않음)을 만들고 평균을 `bmi_mean`에, `bmi >= 25`인 인원을 `n_obese`에 담으세요.",
        expect: ["bmi_mean", "n_obese"],
        hint: "키는 100으로 나눠 미터로",
        solution: String.raw`df["bmi"] = df["weight_kg"] / (df["height_cm"] / 100) ** 2
bmi_mean = float(df["bmi"].mean())
n_obese = int((df["bmi"] >= 25).sum())`,
      },
      {
        id: "s2",
        title: "구간화",
        prompt: "`pd.cut(df['bmi'], bins=[0, 18.5, 23, 25, 100], labels=['저체중', '정상', '과체중', '비만'])`으로 `bmi_grp` 컬럼을 만들고, 최다 그룹 이름을 `top_group`에, '정상' 인원을 `n_normal`에 담으세요.",
        expect: ["top_group", "n_normal"],
        hint: "value_counts().idxmax() — 결과를 str()로 감싸면 안전합니다",
        solution: String.raw`df["bmi_grp"] = pd.cut(df["bmi"], bins=[0, 18.5, 23, 25, 100],
                       labels=["저체중", "정상", "과체중", "비만"])
counts = df["bmi_grp"].value_counts()
top_group = str(counts.idxmax())
n_normal = int(counts.loc["정상"])`,
      },
      {
        id: "s3",
        title: "map 인코딩과 그룹 비교",
        prompt: "`map`으로 `smoker`를 yes→1, no→0인 `smoke_flag` 컬럼으로 인코딩하고, 흡연자 평균 BMI에서 비흡연자 평균 BMI를 뺀 값을 `diff_bmi`에 담으세요.",
        expect: ["diff_bmi"],
        hint: "df['smoker'].map({'yes': 1, 'no': 0})",
        solution: String.raw`df["smoke_flag"] = df["smoker"].map({"yes": 1, "no": 0})
diff_bmi = float(df.loc[df["smoke_flag"] == 1, "bmi"].mean() - df.loc[df["smoke_flag"] == 0, "bmi"].mean())`,
      },
    ],
  },

  {
    id: "sampling",
    title: "표본추출 3종",
    category: "확률과 분포",
    level: 2,
    tags: ["sample", "층화추출", "계통추출"],
    intro: "단순 무작위·복원·층화·계통 추출을 고정 시드로 수행하고 표본 통계를 비교합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(101)
n = 400
df = pd.DataFrame({
    "cust_id": np.arange(1, n + 1),
    "segment": rng.choice(["A", "B", "C"], n, p=[0.6, 0.3, 0.1]),
    "spend": rng.gamma(2, 30000, n).round(-2),
})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "단순·복원 추출",
        prompt: "① `sample(n=80, random_state=42)`(비복원)의 `spend` 평균을 `srs_mean` ② `sample(n=100, replace=True, random_state=7)`(복원)의 평균을 `boot_mean`에 담으세요.",
        expect: ["srs_mean", "boot_mean"],
        hint: "random_state 값을 정확히 지키세요",
        solution: String.raw`srs_mean = float(df.sample(n=80, random_state=42)["spend"].mean())
boot_mean = float(df.sample(n=100, replace=True, random_state=7)["spend"].mean())`,
      },
      {
        id: "s2",
        title: "층화추출",
        prompt: "세그먼트별로 20%씩 뽑는 층화추출을 `df.groupby('segment', group_keys=False).sample(frac=0.2, random_state=42)`로 수행해 표본 크기를 `n_strat`에, 표본 중 A 세그먼트 비중을 `ratio_a`에 담으세요.",
        expect: ["n_strat", "ratio_a"],
        hint: "(strat['segment'] == 'A').mean()",
        solution: String.raw`strat = df.groupby("segment", group_keys=False).sample(frac=0.2, random_state=42)
n_strat = len(strat)
ratio_a = float((strat["segment"] == "A").mean())`,
      },
      {
        id: "s3",
        title: "계통추출",
        prompt: "행 순서 그대로 4번째 행(위치 인덱스 3)부터 10칸 간격으로 뽑는 계통추출(`df.iloc[3::10]`)로 표본 크기를 `n_sys`에, `spend` 평균을 `sys_mean`에 담으세요.",
        expect: ["n_sys", "sys_mean"],
        hint: "iloc 슬라이싱 [시작::간격]",
        solution: String.raw`sys_df = df.iloc[3::10]
n_sys = len(sys_df)
sys_mean = float(sys_df["spend"].mean())`,
      },
    ],
  },

  {
    id: "prob-cond",
    title: "조건부확률과 포아송",
    category: "확률과 분포",
    level: 2,
    tags: ["조건부확률", "베이즈", "poisson"],
    intro: "관측 데이터로 조건부확률을 계산하고, 포아송 분포로 사건 발생 확률을 구합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(103)
n = 500
spam = rng.random(n) < 0.3
link = rng.random(n) < np.where(spam, 0.8, 0.2)
df = pd.DataFrame({"spam": spam.astype(int), "link": link.astype(int)})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "기본 확률",
        prompt: "관측 비율로 ① 스팸 확률 `p_spam` ② 링크 포함 확률 `p_link_all` ③ 스팸이면서 링크 포함인 확률 `p_both`를 담으세요.",
        expect: ["p_spam", "p_link_all", "p_both"],
        hint: "0/1 컬럼의 mean()이 곧 비율입니다",
        solution: String.raw`p_spam = float(df["spam"].mean())
p_link_all = float(df["link"].mean())
p_both = float(((df["spam"] == 1) & (df["link"] == 1)).mean())`,
      },
      {
        id: "s2",
        title: "조건부확률",
        prompt: "① 링크가 있을 때 스팸일 확률 `p_spam_given_link`(= p_both ÷ p_link_all) ② 스팸일 때 링크가 있을 확률 `p_link_given_spam`(= p_both ÷ p_spam)을 담으세요.",
        expect: ["p_spam_given_link", "p_link_given_spam"],
        hint: "조건부확률 정의를 그대로",
        solution: String.raw`p_spam_given_link = p_both / p_link_all
p_link_given_spam = p_both / p_spam`,
      },
      {
        id: "s3",
        title: "포아송 분포",
        prompt: "시간당 평균 3건 문의가 포아송 분포를 따를 때 ① 한 건도 없을 확률 `p0` ② 5건 이상일 확률 `p_ge5`를 담으세요.",
        expect: ["p0", "p_ge5"],
        hint: "scipy.stats.poisson.pmf(0, 3), poisson.sf(4, 3)",
        solution: String.raw`from scipy import stats
p0 = float(stats.poisson.pmf(0, 3))
p_ge5 = float(stats.poisson.sf(4, 3))`,
      },
    ],
  },

  {
    id: "anova-test",
    title: "정규성·ANOVA·상관 유의성",
    category: "추정과 검정",
    level: 3,
    tags: ["shapiro", "f_oneway", "pearsonr"],
    intro: "정규성 검정, 세 그룹 일원분산분석, 상관계수의 유의성 검정을 수행합니다. 유의수준 0.05.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(107)
df = pd.DataFrame({
    "class": ["A"] * 30 + ["B"] * 30 + ["C"] * 30,
    "score": np.concatenate([
        rng.normal(70, 8, 30), rng.normal(74, 8, 30), rng.normal(69, 9, 30),
    ]).round(1),
})
df_xy = pd.DataFrame({"ad": rng.uniform(10, 100, 40).round(1)})
df_xy["rev"] = (2 * df_xy["ad"] + rng.normal(0, 25, 40)).round(1)
df.head()`,
    steps: [
      {
        id: "s1",
        title: "정규성 검정",
        prompt: "A반 점수에 샤피로-윌크 검정을 적용해 통계량을 `w_stat`, p값을 `p_norm`에 담고, 정규성 가정을 기각하는지(`p < 0.05`) `normal_reject`에 담으세요.",
        expect: ["w_stat", "p_norm", "normal_reject"],
        hint: "scipy.stats.shapiro(a_scores)",
        solution: String.raw`from scipy import stats
a_sc = df.loc[df["class"] == "A", "score"]
sh = stats.shapiro(a_sc)
w_stat = float(sh.statistic)
p_norm = float(sh.pvalue)
normal_reject = bool(p_norm < 0.05)`,
      },
      {
        id: "s2",
        title: "일원분산분석",
        prompt: "세 반 평균이 모두 같은지 `f_oneway`로 검정하세요. F통계량 `f_stat`, p값 `p_anova`, 기각 여부 `reject_anova`.",
        expect: ["f_stat", "p_anova", "reject_anova"],
        hint: "stats.f_oneway(a, b, c)",
        solution: String.raw`b_sc = df.loc[df["class"] == "B", "score"]
c_sc = df.loc[df["class"] == "C", "score"]
an = stats.f_oneway(a_sc, b_sc, c_sc)
f_stat = float(an.statistic)
p_anova = float(an.pvalue)
reject_anova = bool(p_anova < 0.05)`,
      },
      {
        id: "s3",
        title: "상관 유의성",
        prompt: "`df_xy`의 `ad`와 `rev`에 `pearsonr`을 적용해 상관계수를 `r_val`, p값을 `p_r`에 담고, 상관이 유의한지 `corr_sig`에 담으세요.",
        expect: ["r_val", "p_r", "corr_sig"],
        hint: "stats.pearsonr(df_xy['ad'], df_xy['rev'])",
        solution: String.raw`pr = stats.pearsonr(df_xy["ad"], df_xy["rev"])
r_val = float(pr.statistic)
p_r = float(pr.pvalue)
corr_sig = bool(p_r < 0.05)`,
      },
    ],
  },

  {
    id: "conf-interval",
    title: "신뢰구간 추정",
    category: "추정과 검정",
    level: 2,
    tags: ["표준오차", "t.interval", "비율"],
    intro: "평균의 t 신뢰구간과 비율의 z 신뢰구간을 계산합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(109)
df = pd.DataFrame({"hours": rng.normal(1200, 100, 40).round(1)})
df.describe()`,
    steps: [
      {
        id: "s1",
        title: "평균과 표준오차",
        prompt: "배터리 수명 표본의 평균을 `mean_h`에, 표준오차(표본표준편차 ddof=1 ÷ √n)를 `se`에 담으세요.",
        expect: ["mean_h", "se"],
        hint: "df['hours'].std() / np.sqrt(len(df))",
        solution: String.raw`mean_h = float(df["hours"].mean())
se = float(df["hours"].std() / np.sqrt(len(df)))`,
      },
      {
        id: "s2",
        title: "평균의 95% 신뢰구간",
        prompt: "`stats.t.interval(0.95, df=n-1, loc=평균, scale=표준오차)`로 95% 신뢰구간을 구해 하한을 `ci_low`, 상한을 `ci_high`에 담으세요.",
        expect: ["ci_low", "ci_high"],
        hint: "자유도는 표본 수 - 1",
        solution: String.raw`from scipy import stats
ci = stats.t.interval(0.95, df=len(df) - 1, loc=mean_h, scale=se)
ci_low = float(ci[0])
ci_high = float(ci[1])`,
      },
      {
        id: "s3",
        title: "비율의 신뢰구간",
        prompt: "400명 중 268명이 만족했습니다. 표본비율을 `p_hat`에 담고, z값 `stats.norm.ppf(0.975)`를 써서 95% 신뢰구간 하한 `p_low`, 상한 `p_high`를 구하세요. (표준오차 = √(p̂(1-p̂)/n))",
        expect: ["p_hat", "p_low", "p_high"],
        hint: "p_hat ± z * se_p",
        solution: String.raw`p_hat = 268 / 400
z = float(stats.norm.ppf(0.975))
se_p = (p_hat * (1 - p_hat) / 400) ** 0.5
p_low = p_hat - z * se_p
p_high = p_hat + z * se_p`,
      },
    ],
  },

  {
    id: "ts-features",
    title: "방문자 시계열 리샘플·자기상관",
    category: "시계열 분석",
    level: 2,
    tags: ["resample", "pct_change", "autocorr"],
    intro: "일별 방문자 수를 주 단위로 리샘플하고 변화율·이동표준편차·자기상관으로 주기성을 확인합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(113)
idx = pd.date_range("2024-01-01", periods=120, freq="D")
base = 200 + 40 * np.sin(2 * np.pi * np.arange(120) / 7)
s = pd.Series((base + rng.normal(0, 15, 120)).round(0), index=idx, name="visitors")
s.head()`,
    steps: [
      {
        id: "s1",
        title: "주 단위 리샘플",
        prompt: "`resample('W').sum()`으로 주간 합계 `weekly`를 만들고 최대 주간 방문자를 `max_week`에, 주 개수를 `n_weeks`에 담으세요.",
        expect: ["max_week", "n_weeks"],
        hint: "weekly.max(), len(weekly)",
        solution: String.raw`weekly = s.resample("W").sum()
max_week = float(weekly.max())
n_weeks = len(weekly)`,
      },
      {
        id: "s2",
        title: "변화율과 변동성",
        prompt: "전일 대비 변화율(`pct_change()`)의 최댓값을 `max_pct`에, 7일 이동 표준편차(`rolling(7).std()`)의 평균을 `mean_std7`에 담으세요.",
        expect: ["max_pct", "mean_std7"],
        hint: "결측은 mean()/max()가 알아서 제외합니다",
        solution: String.raw`max_pct = float(s.pct_change().max())
mean_std7 = float(s.rolling(7).std().mean())`,
      },
      {
        id: "s3",
        title: "자기상관과 주기성",
        prompt: "lag 1 자기상관을 `ac1`, lag 7 자기상관을 `ac7`에 담고(`s.autocorr(lag=...)`), 주간 주기성이 있는지 `weekly_pattern = ac7 > ac1`(bool)로 판단하세요.",
        expect: ["ac1", "ac7", "weekly_pattern"],
        hint: "7일 주기 신호라면 lag 7 상관이 커야 합니다",
        solution: String.raw`ac1 = float(s.autocorr(lag=1))
ac7 = float(s.autocorr(lag=7))
weekly_pattern = bool(ac7 > ac1)`,
      },
    ],
  },

  {
    id: "ridge-poly",
    title: "다항 특징과 릿지 회귀",
    category: "회귀",
    level: 3,
    tags: ["PolynomialFeatures", "Ridge", "r2"],
    intro: "비선형 데이터에 다항 특징을 만들어 선형·릿지 회귀 성능을 비교합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(127)
n = 150
x = rng.uniform(-3, 3, n)
df = pd.DataFrame({
    "x": x.round(3),
    "y": (0.5 * x ** 3 - 2 * x + 4 + rng.normal(0, 2, n)).round(3),
})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "선형 기준선",
        prompt: "`X = df[['x']]`, `y = df['y']`를 `train_test_split(test_size=0.3, random_state=42)`로 나누고, `LinearRegression`의 테스트 R²을 `r2_lin`에 담으세요.",
        expect: ["r2_lin"],
        hint: "r2_score 또는 model.score(X_test, y_test)",
        solution: String.raw`from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
X = df[["x"]]
y = df["y"]
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)
r2_lin = float(LinearRegression().fit(X_train, y_train).score(X_test, y_test))`,
      },
      {
        id: "s2",
        title: "다항 특징",
        prompt: "`PolynomialFeatures(degree=3, include_bias=False)`를 **훈련 데이터로만 fit**해 훈련·테스트를 변환하세요. 변환 후 특징 수를 `n_feat`에, 그 위에서 학습한 선형회귀의 테스트 R²을 `r2_poly`에 담으세요.",
        expect: ["n_feat", "r2_poly"],
        hint: "poly.fit_transform(X_train), poly.transform(X_test)",
        solution: String.raw`from sklearn.preprocessing import PolynomialFeatures
poly = PolynomialFeatures(degree=3, include_bias=False)
Xtr_p = poly.fit_transform(X_train)
Xte_p = poly.transform(X_test)
n_feat = Xtr_p.shape[1]
r2_poly = float(LinearRegression().fit(Xtr_p, y_train).score(Xte_p, y_test))`,
      },
      {
        id: "s3",
        title: "릿지 규제",
        prompt: "같은 3차 다항 특징에 `Ridge(alpha=1.0)`을 학습해 테스트 R²을 `r2_ridge`에 담고, 다항 모델이 선형보다 나은지 `poly_better`(bool)에 담으세요.",
        expect: ["r2_ridge", "poly_better"],
        hint: "from sklearn.linear_model import Ridge",
        solution: String.raw`from sklearn.linear_model import Ridge
r2_ridge = float(Ridge(alpha=1.0).fit(Xtr_p, y_train).score(Xte_p, y_test))
poly_better = bool(r2_poly > r2_lin)`,
      },
    ],
  },

  {
    id: "model-tuning",
    title: "교차검증과 그리드서치",
    category: "모델 최적화",
    level: 3,
    tags: ["cross_val_score", "GridSearchCV", "KNN"],
    intro: "교차검증으로 모델을 평가하고 GridSearchCV로 하이퍼파라미터를 탐색합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(131)
n = 300
x1 = rng.normal(0, 1, n)
x2 = rng.normal(0, 1, n)
x3 = rng.normal(0, 1, n)
df = pd.DataFrame({
    "x1": x1, "x2": x2, "x3": x3,
    "y": ((1.5 * x1 - x2 + 0.5 * x3 + rng.normal(0, 1, n)) > 0).astype(int),
})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "교차검증",
        prompt: "`X = df[['x1','x2','x3']]`, `y = df['y']`에 대해 `cross_val_score(LogisticRegression(max_iter=1000), X, y, cv=5, scoring='accuracy')`의 평균을 `cv_mean`, 표준편차를 `cv_std`에 담으세요.",
        expect: ["cv_mean", "cv_std"],
        hint: "scores.mean(), scores.std()",
        solution: String.raw`from sklearn.model_selection import cross_val_score
from sklearn.linear_model import LogisticRegression
X = df[["x1", "x2", "x3"]]
y = df["y"]
scores = cross_val_score(LogisticRegression(max_iter=1000), X, y, cv=5, scoring="accuracy")
cv_mean = float(scores.mean())
cv_std = float(scores.std())`,
      },
      {
        id: "s2",
        title: "그리드서치",
        prompt: "`GridSearchCV(DecisionTreeClassifier(random_state=42), {'max_depth': [2, 3, 4, 5], 'min_samples_split': [2, 10]}, cv=5)`를 학습해 최적 `max_depth`를 `best_depth`(int)에, 최고 교차검증 점수를 `gs_best`에 담으세요.",
        expect: ["best_depth", "gs_best"],
        hint: "gs.best_params_['max_depth'], gs.best_score_",
        solution: String.raw`from sklearn.model_selection import GridSearchCV
from sklearn.tree import DecisionTreeClassifier
gs = GridSearchCV(DecisionTreeClassifier(random_state=42),
                  {"max_depth": [2, 3, 4, 5], "min_samples_split": [2, 10]}, cv=5)
gs.fit(X, y)
best_depth = int(gs.best_params_["max_depth"])
gs_best = float(gs.best_score_)`,
      },
      {
        id: "s3",
        title: "KNN k 탐색",
        prompt: "k ∈ [3, 5, 7, 9]의 `KNeighborsClassifier`를 각각 `cross_val_score(..., cv=5)` 평균으로 비교해, 가장 좋은 k를 `best_k`(int)에, 그 평균 점수를 `best_knn_score`에 담으세요.",
        expect: ["best_k", "best_knn_score"],
        hint: "dict에 k별 평균을 모아 max(d, key=d.get)",
        solution: String.raw`from sklearn.neighbors import KNeighborsClassifier
knn_scores = {}
for k in [3, 5, 7, 9]:
    knn_scores[k] = float(cross_val_score(KNeighborsClassifier(n_neighbors=k), X, y, cv=5).mean())
best_k = int(max(knn_scores, key=knn_scores.get))
best_knn_score = knn_scores[best_k]`,
      },
    ],
  },

  {
    id: "cluster-hier",
    title: "계층적 군집과 k-means 비교",
    category: "군집",
    level: 3,
    tags: ["linkage", "fcluster", "AgglomerativeClustering"],
    intro: "와드 연결 계층적 군집을 수행하고 k-means와 실루엣 계수로 비교합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(137)
a = rng.normal((0.0, 0.0), 0.7, (40, 2))
b = rng.normal((4.0, 0.0), 0.7, (40, 2))
c = rng.normal((2.0, 3.5), 0.7, (40, 2))
df = pd.DataFrame(np.vstack([a, b, c]).round(3), columns=["f1", "f2"])
df.head()`,
    steps: [
      {
        id: "s1",
        title: "와드 연결",
        prompt: "`scipy.cluster.hierarchy.linkage(df, method='ward')`로 연결행렬 `Z`를 만들고, 마지막 병합 거리(`Z[-1, 2]`)를 `last_merge`에, 병합 횟수(`len(Z)`)를 `n_merges`에 담으세요.",
        expect: ["last_merge", "n_merges"],
        hint: "from scipy.cluster.hierarchy import linkage",
        solution: String.raw`from scipy.cluster.hierarchy import linkage
Z = linkage(df, method="ward")
last_merge = float(Z[-1, 2])
n_merges = len(Z)`,
      },
      {
        id: "s2",
        title: "군집 자르기",
        prompt: "`fcluster(Z, t=3, criterion='maxclust')`로 3개 군집 라벨을 얻어, 군집 크기를 **내림차순 정렬한 리스트** `sizes_h`에 담으세요.",
        expect: ["sizes_h"],
        hint: "np.bincount는 라벨이 1부터라 [1:]를 쓰거나 pd.Series(labels).value_counts()",
        solution: String.raw`from scipy.cluster.hierarchy import fcluster
labels_h = fcluster(Z, t=3, criterion="maxclust")
sizes_h = sorted((int(v) for v in pd.Series(labels_h).value_counts()), reverse=True)`,
      },
      {
        id: "s3",
        title: "실루엣 비교",
        prompt: "`AgglomerativeClustering(n_clusters=3, linkage='ward')`와 `KMeans(n_clusters=3, random_state=42, n_init=10)`의 실루엣 계수를 각각 `sil_h`, `sil_k`에 담고, 더 좋은 방법 이름(`'hier'` 또는 `'kmeans'`)을 `better`에 담으세요.",
        expect: ["sil_h", "sil_k", "better"],
        hint: "silhouette_score(df, labels)",
        solution: String.raw`from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.metrics import silhouette_score
agg_labels = AgglomerativeClustering(n_clusters=3, linkage="ward").fit_predict(df)
km_labels = KMeans(n_clusters=3, random_state=42, n_init=10).fit_predict(df)
sil_h = float(silhouette_score(df, agg_labels))
sil_k = float(silhouette_score(df, km_labels))
better = "hier" if sil_h > sil_k else "kmeans"`,
      },
    ],
  },

  {
    id: "tree-interpret",
    title: "결정트리 분기조건 해석",
    category: "분류",
    level: 2,
    tags: ["DecisionTree", "분기조건", "feature_importances_"],
    intro: "대출 승인 결정트리를 학습해 루트 분기조건과 변수 중요도를 해석합니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(139)
n = 250
income = rng.normal(400, 120, n).round(0)
credit = rng.integers(300, 1000, n)
debt = np.clip(rng.normal(150, 80, n), 0, None).round(0)
approve = (((credit > 600) & (income - debt > 150)) | (rng.random(n) < 0.05)).astype(int)
df = pd.DataFrame({"income": income, "credit": credit, "debt": debt, "approve": approve})
df.head()`,
    steps: [
      {
        id: "s1",
        title: "학습과 과적합 확인",
        prompt: "`X = df[['income','credit','debt']]`, `y = df['approve']`를 `train_test_split(test_size=0.3, random_state=42)`로 나누고 `DecisionTreeClassifier(max_depth=3, random_state=42)`를 학습하세요. 테스트 정확도를 `acc_tree`, 훈련 정확도를 `acc_train`에 담으세요.",
        expect: ["acc_tree", "acc_train"],
        hint: "model.score(X_train, y_train)도 정확도입니다",
        solution: String.raw`from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier
feat_names = ["income", "credit", "debt"]
X = df[feat_names]
y = df["approve"]
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)
tree = DecisionTreeClassifier(max_depth=3, random_state=42).fit(X_train, y_train)
acc_tree = float(tree.score(X_test, y_test))
acc_train = float(tree.score(X_train, y_train))`,
      },
      {
        id: "s2",
        title: "루트 분기조건",
        prompt: "트리의 **루트 노드** 분기 변수 이름을 `root_feat`에, 분기 임계값을 `root_thr`에 담으세요. (`tree.tree_.feature[0]`, `tree.tree_.threshold[0]`)",
        expect: ["root_feat", "root_thr"],
        hint: "feature[0]은 변수 인덱스 — 이름 리스트로 변환",
        solution: String.raw`root_feat = feat_names[int(tree.tree_.feature[0])]
root_thr = float(tree.tree_.threshold[0])`,
      },
      {
        id: "s3",
        title: "중요도와 잎 노드",
        prompt: "`feature_importances_`가 가장 큰 변수 이름을 `top_imp_feat`에, 그 중요도를 `top_imp`에, 잎 노드 수(`get_n_leaves()`)를 `n_leaves`에 담으세요.",
        expect: ["top_imp_feat", "top_imp", "n_leaves"],
        hint: "np.argmax(tree.feature_importances_)",
        solution: String.raw`top_imp_feat = feat_names[int(np.argmax(tree.feature_importances_))]
top_imp = float(tree.feature_importances_.max())
n_leaves = int(tree.get_n_leaves())`,
      },
    ],
  },

  // ---------- 실전 대문제 (kind: "big") ----------
  // 실제 시험 구조: 큰 데이터셋 1개 + 중문제 3개(조건 필터), 중문제당 3~7단계로
  // 변수를 차례로 만든다. 실전 모드는 이 중 2개를 무작위 출제한다.
  {
    id: "big-shop",
    title: "대문제 · 온라인 쇼핑몰 주문 분석",
    category: "실전 대문제",
    kind: "big",
    level: 3,
    tags: ["필터링", "집계", "정제"],
    intro: "주문 2,000건 데이터셋 하나로 중문제 3개를 풉니다. 중문제 1·2는 데이터프레임 처리, 중문제 3은 가변수 생성 + 모델 학습입니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(211)
n = 2000
cats = rng.choice(["전자", "패션", "식품", "뷰티", "가구"], n, p=[0.25, 0.25, 0.2, 0.18, 0.12])
base = {"전자": 180000, "패션": 60000, "식품": 25000, "뷰티": 40000, "가구": 250000}
rating = rng.integers(1, 6, n).astype(float)
rating[rng.choice(n, 260, replace=False)] = np.nan
df = pd.DataFrame({
    "order_id": np.arange(1, n + 1),
    "order_date": pd.Timestamp("2024-03-01") + pd.to_timedelta(rng.integers(0, 90, n), unit="D"),
    "category": cats,
    "region": rng.choice(["수도권", "영남", "호남", "충청", "강원"], n, p=[0.45, 0.25, 0.12, 0.12, 0.06]),
    "price": (np.array([base[c] for c in cats]) * rng.uniform(0.5, 1.8, n)).round(-2),
    "qty": rng.integers(1, 5, n),
    "coupon": rng.choice([0, 1], n, p=[0.7, 0.3]),
    "member_grade": rng.choice(["bronze", "silver", "gold", "vip"], n, p=[0.4, 0.3, 0.2, 0.1]),
    "rating": rating,
})
df.head()`,
    sections: [
      {
        title: "중문제 1 · 수도권 전자제품 주문",
        cond: "조건: `region == '수도권'` 이고 `category == '전자'` 인 주문만.",
        steps: [
          {
            id: "a1",
            title: "필터링",
            prompt: "조건에 맞는 행만 추려 `df_a`를 만들고(`copy()` 권장) 행 수를 `a_rows`에 담으세요.",
            expect: ["a_rows"],
            hint: "df[(조건1) & (조건2)].copy()",
            solution: String.raw`df_a = df[(df["region"] == "수도권") & (df["category"] == "전자")].copy()
a_rows = len(df_a)`,
          },
          {
            id: "a2",
            title: "주문금액",
            prompt: "`df_a`에 `amount`(= `price * qty`) 컬럼을 만들고 총매출을 `a_total`에, 평균 주문금액을 `a_mean`에 담으세요.",
            expect: ["a_total", "a_mean"],
            hint: "sum(), mean()",
            solution: String.raw`df_a["amount"] = df_a["price"] * df_a["qty"]
a_total = float(df_a["amount"].sum())
a_mean = float(df_a["amount"].mean())`,
          },
          {
            id: "a3",
            title: "쿠폰 효과",
            prompt: "쿠폰 사용(1) 주문의 평균 `amount`에서 미사용(0) 평균을 뺀 값을 `a_coupon_diff`에 담으세요.",
            expect: ["a_coupon_diff"],
            hint: "groupby('coupon')['amount'].mean() 후 빼기",
            solution: String.raw`cm = df_a.groupby("coupon")["amount"].mean()
a_coupon_diff = float(cm.loc[1] - cm.loc[0])`,
          },
          {
            id: "a4",
            title: "상위 매출일",
            prompt: "일자별(`order_date`의 날짜 단위) `amount` 합계에서 상위 3일의 합을 `a_top3`에 담으세요.",
            expect: ["a_top3"],
            hint: "groupby(dt.date) 후 nlargest(3).sum()",
            solution: String.raw`daily_a = df_a.groupby(df_a["order_date"].dt.date)["amount"].sum()
a_top3 = float(daily_a.nlargest(3).sum())`,
          },
        ],
      },
      {
        title: "중문제 2 · 평점 데이터 정제",
        cond: "조건: `rating`이 결측이 아닌 주문만.",
        steps: [
          {
            id: "b1",
            title: "결측 제거",
            prompt: "전체에서 `rating` 결측 비율을 `b_na_ratio`에 담고, 결측을 제거한 `df_b`를 만드세요.",
            expect: ["b_na_ratio"],
            hint: "isna().mean(), dropna(subset=['rating'])",
            solution: String.raw`b_na_ratio = float(df["rating"].isna().mean())
df_b = df.dropna(subset=["rating"]).copy()`,
          },
          {
            id: "b2",
            title: "등급별 평점",
            prompt: "`df_b`에서 회원 등급별 평균 평점을 **내림차순 Series** `b_grade_rating`에 담으세요.",
            expect: ["b_grade_rating"],
            hint: "groupby('member_grade')['rating'].mean().sort_values(ascending=False)",
            solution: String.raw`b_grade_rating = df_b.groupby("member_grade")["rating"].mean().sort_values(ascending=False)`,
          },
          {
            id: "b3",
            title: "평점 표준화",
            prompt: "`df_b`의 평점을 z-score(`ddof=0`)로 표준화해 `|z| > 1.3`인 주문 수를 `b_extreme`에 담으세요.",
            expect: ["b_extreme"],
            hint: "(rating - mean) / std(ddof=0)",
            solution: String.raw`z_b = (df_b["rating"] - df_b["rating"].mean()) / df_b["rating"].std(ddof=0)
b_extreme = int((z_b.abs() > 1.3).sum())`,
          },
          {
            id: "b4",
            title: "카테고리 평점 1위",
            prompt: "카테고리별 평균 평점이 가장 높은 카테고리를 `b_best_cat`에, 그 값을 `b_best_val`에 담으세요.",
            expect: ["b_best_cat", "b_best_val"],
            hint: "idxmax(), max()",
            solution: String.raw`cat_rating = df_b.groupby("category")["rating"].mean()
b_best_cat = cat_rating.idxmax()
b_best_val = float(cat_rating.max())`,
          },
          {
            id: "b5",
            title: "고평점 비율",
            prompt: "`df_b`에서 평점 4점 이상 주문의 비율을 `b_high_ratio`에 담으세요.",
            expect: ["b_high_ratio"],
            hint: "(df_b['rating'] >= 4).mean()",
            solution: String.raw`b_high_ratio = float((df_b["rating"] >= 4).mean())`,
          },
        ],
      },
      {
        title: "중문제 3 · 주문금액 예측 모델링",
        cond: "조건: `qty >= 2` 인 주문만. 가변수를 만들어 주문금액을 예측합니다.",
        steps: [
          {
            id: "c1",
            title: "필터와 타깃",
            prompt: "`qty >= 2`인 주문만 담은 `df_c`를 만들고 `amount`(= `price * qty`) 컬럼을 추가하세요. 행 수를 `c_rows`에, 평균 주문금액을 `c_mean_amt`에 담으세요.",
            expect: ["c_rows", "c_mean_amt"],
            hint: "df[df['qty'] >= 2].copy() 후 amount 파생",
            solution: String.raw`df_c = df[df["qty"] >= 2].copy()
df_c["amount"] = df_c["price"] * df_c["qty"]
c_rows = len(df_c)
c_mean_amt = float(df_c["amount"].mean())`,
          },
          {
            id: "c2",
            title: "가변수 생성",
            prompt: "`df_c[['qty', 'coupon', 'category', 'region']]`에 `pd.get_dummies(columns=['category', 'region'])`를 적용한 `df_e`를 만드세요. 더미 컬럼 수(`category_`/`region_`으로 시작)를 `c_dummy_cols`에, 전체 컬럼 수를 `c_ncols`에 담으세요.",
            expect: ["c_dummy_cols", "c_ncols"],
            hint: "더미 컬럼 수 = 카테고리 5종 + 지역 5종",
            solution: String.raw`df_e = pd.get_dummies(df_c[["qty", "coupon", "category", "region"]],
                      columns=["category", "region"])
c_dummy_cols = sum(1 for c in df_e.columns if c.startswith("category_") or c.startswith("region_"))
c_ncols = int(df_e.shape[1])`,
          },
          {
            id: "c3",
            title: "선형회귀",
            prompt: "`X = df_e`, `y = df_c['amount']`를 `train_test_split(test_size=0.3, random_state=42)`로 나누고 `LinearRegression`의 테스트 R²을 `c_r2`에, RMSE(`np.sqrt(mean_squared_error)`)를 `c_rmse`에 담으세요.",
            expect: ["c_r2", "c_rmse"],
            hint: "가변수 덕분에 카테고리 정보가 모델에 들어갑니다",
            solution: String.raw`from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score, mean_squared_error
X_s = df_e
y_s = df_c["amount"]
Xs_tr, Xs_te, ys_tr, ys_te = train_test_split(X_s, y_s, test_size=0.3, random_state=42)
lr_s = LinearRegression().fit(Xs_tr, ys_tr)
pred_s = lr_s.predict(Xs_te)
c_r2 = float(r2_score(ys_te, pred_s))
c_rmse = float(np.sqrt(mean_squared_error(ys_te, pred_s)))`,
          },
          {
            id: "c4",
            title: "트리 비교",
            prompt: "`DecisionTreeRegressor(max_depth=5, random_state=42)`의 테스트 RMSE를 `c_rmse_dt`에 담고, 선형회귀보다 나은지 `c_tree_better`(bool)에 담으세요.",
            expect: ["c_rmse_dt", "c_tree_better"],
            hint: "같은 분할 데이터를 재사용",
            solution: String.raw`from sklearn.tree import DecisionTreeRegressor
dt_s = DecisionTreeRegressor(max_depth=5, random_state=42).fit(Xs_tr, ys_tr)
c_rmse_dt = float(np.sqrt(mean_squared_error(ys_te, dt_s.predict(Xs_te))))
c_tree_better = bool(c_rmse_dt < c_rmse)`,
          },
          {
            id: "c5",
            title: "중요 변수",
            prompt: "트리의 `feature_importances_`가 가장 큰 변수 이름을 `c_top_feat`에 담으세요. (`df_e.columns` 기준)",
            expect: ["c_top_feat"],
            hint: "df_e.columns[np.argmax(...)]",
            solution: String.raw`c_top_feat = str(df_e.columns[int(np.argmax(dt_s.feature_importances_))])`,
          },
        ],
      },
    ],
  },

  {
    id: "big-hr",
    title: "대문제 · 직원 인사 데이터 분석",
    category: "실전 대문제",
    kind: "big",
    level: 3,
    tags: ["구간화", "이직률", "회귀"],
    intro: "직원 1,200명 인사 데이터셋 하나로 중문제 3개를 풉니다. 중문제 1·2는 데이터프레임 처리(부서 필터·이직자 분석), 중문제 3은 가변수 생성 + 연봉 모델링입니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(223)
n = 1200
dept = rng.choice(["개발", "영업", "마케팅", "인사", "재무"], n, p=[0.35, 0.25, 0.15, 0.12, 0.13])
years = rng.integers(0, 26, n)
edu = rng.choice(["고졸", "학사", "석사", "박사"], n, p=[0.1, 0.6, 0.25, 0.05])
edu_bonus = {"고졸": 0, "학사": 400, "석사": 900, "박사": 1600}
overtime = np.clip(rng.normal(20, 12, n), 0, None).round(1)
satisfaction = np.clip(rng.normal(3.2, 0.8, n) - overtime * 0.02, 1, 5).round(2)
left_p = 1 / (1 + np.exp(-(0.05 * overtime - 0.8 * (satisfaction - 3) - 0.04 * years - 0.5)))
df = pd.DataFrame({
    "emp_id": np.arange(1, n + 1),
    "dept": dept,
    "years": years,
    "edu": edu,
    "salary": (3000 + years * 180 + np.array([edu_bonus[e] for e in edu]) + rng.normal(0, 400, n)).round(0),
    "overtime_h": overtime,
    "satisfaction": satisfaction,
    "left": (rng.random(n) < left_p).astype(int),
})
df.head()`,
    sections: [
      {
        title: "중문제 1 · 개발 부서 분석",
        cond: "조건: `dept == '개발'` 인 직원만.",
        steps: [
          {
            id: "a1",
            title: "필터링",
            prompt: "개발 부서만 담은 `df_a`를 만들고 행 수를 `a_rows`에 담으세요.",
            expect: ["a_rows"],
            hint: "df[df['dept'] == '개발'].copy()",
            solution: String.raw`df_a = df[df["dept"] == "개발"].copy()
a_rows = len(df_a)`,
          },
          {
            id: "a2",
            title: "연차 구간화",
            prompt: "`pd.cut(df_a['years'], bins=[-1, 3, 7, 15, 26], labels=['신입', '주니어', '시니어', '베테랑'])`으로 구간화해 최다 구간 이름을 `a_top_band`에 담으세요.",
            expect: ["a_top_band"],
            hint: "value_counts().idxmax()를 str()로",
            solution: String.raw`band = pd.cut(df_a["years"], bins=[-1, 3, 7, 15, 26],
              labels=["신입", "주니어", "시니어", "베테랑"])
a_top_band = str(band.value_counts().idxmax())`,
          },
          {
            id: "a3",
            title: "연차-연봉 상관",
            prompt: "개발 부서에서 `years`와 `salary`의 pearson 상관계수를 `a_corr`에 담으세요.",
            expect: ["a_corr"],
            hint: "Series.corr(other)",
            solution: String.raw`a_corr = float(df_a["years"].corr(df_a["salary"]))`,
          },
          {
            id: "a4",
            title: "초과근무 상위 10%",
            prompt: "초과근무의 90백분위수를 `a_p90`에 담고, 그보다 **큰** 직원 수를 `a_over90`에 담으세요.",
            expect: ["a_p90", "a_over90"],
            hint: "quantile(0.9)",
            solution: String.raw`a_p90 = float(df_a["overtime_h"].quantile(0.9))
a_over90 = int((df_a["overtime_h"] > a_p90).sum())`,
          },
          {
            id: "a5",
            title: "학력별 연봉",
            prompt: "개발 부서의 학력별 평균 연봉을 **내림차순 Series** `a_sal_by_edu`에 담으세요.",
            expect: ["a_sal_by_edu"],
            hint: "groupby('edu')['salary'].mean().sort_values(ascending=False)",
            solution: String.raw`a_sal_by_edu = df_a.groupby("edu")["salary"].mean().sort_values(ascending=False)`,
          },
        ],
      },
      {
        title: "중문제 2 · 이직자 분석",
        cond: "조건: `left == 1` (이직자)만. 비교 기준은 전체 `df`.",
        steps: [
          {
            id: "b1",
            title: "이직 규모",
            prompt: "이직자만 담은 `df_b`를 만들어 행 수를 `b_rows`에, 전체 이직률을 `b_ratio`에 담으세요.",
            expect: ["b_rows", "b_ratio"],
            hint: "df['left'].mean()이 곧 이직률",
            solution: String.raw`df_b = df[df["left"] == 1].copy()
b_rows = len(df_b)
b_ratio = float(df["left"].mean())`,
          },
          {
            id: "b2",
            title: "만족도 차이",
            prompt: "재직자(`left == 0`) 평균 만족도에서 이직자 평균 만족도를 뺀 값을 `b_sat_diff`에 담으세요.",
            expect: ["b_sat_diff"],
            hint: "groupby('left')['satisfaction'].mean()",
            solution: String.raw`sat = df.groupby("left")["satisfaction"].mean()
b_sat_diff = float(sat.loc[0] - sat.loc[1])`,
          },
          {
            id: "b3",
            title: "부서별 이직률",
            prompt: "부서별 이직률이 가장 높은 부서를 `b_worst_dept`에, 그 이직률을 `b_worst_rate`에 담으세요.",
            expect: ["b_worst_dept", "b_worst_rate"],
            hint: "groupby('dept')['left'].mean() 후 idxmax()",
            solution: String.raw`dept_rate = df.groupby("dept")["left"].mean()
b_worst_dept = dept_rate.idxmax()
b_worst_rate = float(dept_rate.max())`,
          },
          {
            id: "b4",
            title: "초과근무 비교",
            prompt: "이직자의 평균 초과근무를 `b_ot_mean`에, 이직자 평균에서 재직자 평균을 뺀 값을 `b_ot_diff`에 담으세요.",
            expect: ["b_ot_mean", "b_ot_diff"],
            hint: "df_b와 df[df['left'] == 0]을 비교",
            solution: String.raw`b_ot_mean = float(df_b["overtime_h"].mean())
b_ot_diff = float(b_ot_mean - df.loc[df["left"] == 0, "overtime_h"].mean())`,
          },
        ],
      },
      {
        title: "중문제 3 · 연봉 모델링",
        cond: "조건: `years >= 1` 인 직원만으로 연봉 예측 모델을 만듭니다.",
        steps: [
          {
            id: "c1",
            title: "필터링",
            prompt: "`years >= 1`인 직원만 담은 `df_c`를 만들고 행 수를 `c_rows`에 담으세요.",
            expect: ["c_rows"],
            hint: "df[df['years'] >= 1].copy()",
            solution: String.raw`df_c = df[df["years"] >= 1].copy()
c_rows = len(df_c)`,
          },
          {
            id: "c2",
            title: "가변수 준비",
            prompt: "`df_c[['years', 'overtime_h', 'satisfaction', 'dept', 'edu']]`에 `pd.get_dummies(columns=['dept', 'edu'])`를 적용한 `df_d`를 만들고 컬럼 수를 `c_ncols`에 담으세요.",
            expect: ["c_ncols"],
            hint: "df_d.shape[1]",
            solution: String.raw`df_d = pd.get_dummies(df_c[["years", "overtime_h", "satisfaction", "dept", "edu"]],
                      columns=["dept", "edu"])
c_ncols = int(df_d.shape[1])`,
          },
          {
            id: "c3",
            title: "선형회귀",
            prompt: "`X = df_d`, `y = df_c['salary']`를 `train_test_split(test_size=0.3, random_state=42)`로 나누고 `LinearRegression`의 테스트 R²을 `c_r2`에, RMSE(`np.sqrt(mean_squared_error)`)를 `c_rmse`에 담으세요.",
            expect: ["c_r2", "c_rmse"],
            hint: "sklearn.metrics의 r2_score, mean_squared_error",
            solution: String.raw`from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score, mean_squared_error
X_c = df_d
y_c = df_c["salary"]
Xc_tr, Xc_te, yc_tr, yc_te = train_test_split(X_c, y_c, test_size=0.3, random_state=42)
lr_c = LinearRegression().fit(Xc_tr, yc_tr)
pred_c = lr_c.predict(Xc_te)
c_r2 = float(r2_score(yc_te, pred_c))
c_rmse = float(np.sqrt(mean_squared_error(yc_te, pred_c)))`,
          },
          {
            id: "c4",
            title: "핵심 변수",
            prompt: "수치 변수(`years`, `overtime_h`, `satisfaction`) 중 `salary`와 상관(절댓값)이 가장 높은 변수 이름을 `c_best_feat`에 담으세요. (`df_c` 기준)",
            expect: ["c_best_feat"],
            hint: "corr()['salary'].drop('salary').abs().idxmax()",
            solution: String.raw`num_corr = df_c[["years", "overtime_h", "satisfaction", "salary"]].corr()["salary"].drop("salary")
c_best_feat = num_corr.abs().idxmax()`,
          },
          {
            id: "c5",
            title: "트리 비교",
            prompt: "`DecisionTreeRegressor(max_depth=4, random_state=42)`의 테스트 RMSE를 `c_rmse_dt`에 담고, 선형회귀보다 나은지 `c_tree_better`(bool)에 담으세요.",
            expect: ["c_rmse_dt", "c_tree_better"],
            hint: "같은 분할 데이터를 재사용",
            solution: String.raw`from sklearn.tree import DecisionTreeRegressor
dt_c = DecisionTreeRegressor(max_depth=4, random_state=42).fit(Xc_tr, yc_tr)
c_rmse_dt = float(np.sqrt(mean_squared_error(yc_te, dt_c.predict(Xc_te))))
c_tree_better = bool(c_rmse_dt < c_rmse)`,
          },
        ],
      },
    ],
  },

  {
    id: "big-gym",
    title: "대문제 · 헬스장 회원 이용 분석",
    category: "실전 대문제",
    kind: "big",
    level: 3,
    tags: ["between", "카이제곱", "군집"],
    intro: "회원 1,500명 이용 데이터셋 하나로 중문제 3개를 풉니다. 중문제 1·2는 데이터프레임 처리(연령대 필터·장기권 이탈), 중문제 3은 가변수 생성 + 이탈 예측 모델링입니다.",
    setup: String.raw`import numpy as np
import pandas as pd

rng = np.random.default_rng(227)
n = 1500
visits = np.clip(rng.normal(2.5, 1.2, n), 0, 7).round(1)
pt = rng.choice([0, 0, 0, 4, 8, 12], n)
churn_p = 1 / (1 + np.exp(-(-0.8 * visits - 0.05 * pt + 2.2)))
df = pd.DataFrame({
    "member_id": np.arange(1, n + 1),
    "age": rng.integers(18, 65, n),
    "gender": rng.choice(["M", "F"], n),
    "plan": rng.choice(["1개월", "6개월", "12개월"], n, p=[0.3, 0.35, 0.35]),
    "visits_per_week": visits,
    "pt_sessions": pt,
    "weight_change": (-0.6 * visits - 0.45 * (pt > 0) + rng.normal(1.5, 2.0, n)).round(1),
    "churn": (rng.random(n) < churn_p).astype(int),
})
df.head()`,
    sections: [
      {
        title: "중문제 1 · 20~30대 회원",
        cond: "조건: `age`가 20 이상 39 이하인 회원만.",
        steps: [
          {
            id: "a1",
            title: "필터링",
            prompt: "20~39세 회원만 담은 `df_a`를 만들고(`between(20, 39)`) 행 수를 `a_rows`에 담으세요.",
            expect: ["a_rows"],
            hint: "df[df['age'].between(20, 39)].copy()",
            solution: String.raw`df_a = df[df["age"].between(20, 39)].copy()
a_rows = len(df_a)`,
          },
          {
            id: "a2",
            title: "성별 방문 차이",
            prompt: "남성(M) 평균 주간 방문에서 여성(F) 평균을 뺀 값을 `a_visit_diff`에 담으세요.",
            expect: ["a_visit_diff"],
            hint: "groupby('gender')['visits_per_week'].mean()",
            solution: String.raw`gv = df_a.groupby("gender")["visits_per_week"].mean()
a_visit_diff = float(gv.loc["M"] - gv.loc["F"])`,
          },
          {
            id: "a3",
            title: "PT 효과",
            prompt: "PT 세션이 있는(`pt_sessions > 0`) 회원의 평균 체중변화에서 없는 회원 평균을 뺀 값을 `a_pt_effect`에 담으세요.",
            expect: ["a_pt_effect"],
            hint: "불리언 마스크 두 개로 평균 비교",
            solution: String.raw`has_pt = df_a["pt_sessions"] > 0
a_pt_effect = float(df_a.loc[has_pt, "weight_change"].mean() - df_a.loc[~has_pt, "weight_change"].mean())`,
          },
          {
            id: "a4",
            title: "상위 방문 경계",
            prompt: "주간 방문 빈도의 75백분위수(상위 25% 경계)를 `a_q75`에 담으세요.",
            expect: ["a_q75"],
            hint: "quantile(0.75)",
            solution: String.raw`a_q75 = float(df_a["visits_per_week"].quantile(0.75))`,
          },
        ],
      },
      {
        title: "중문제 2 · 12개월권 이탈 분석",
        cond: "조건: `plan == '12개월'` 인 회원만. (데이터프레임 처리)",
        steps: [
          {
            id: "b1",
            title: "필터와 이탈률",
            prompt: "12개월권 회원만 담은 `df_b`를 만들어 행 수를 `b_rows`에, 이탈률을 `b_churn_rate`에 담으세요.",
            expect: ["b_rows", "b_churn_rate"],
            hint: "df_b['churn'].mean()",
            solution: String.raw`df_b = df[df["plan"] == "12개월"].copy()
b_rows = len(df_b)
b_churn_rate = float(df_b["churn"].mean())`,
          },
          {
            id: "b2",
            title: "방문 격차",
            prompt: "유지 회원(`churn == 0`)의 평균 방문에서 이탈 회원 평균을 뺀 값을 `b_visit_gap`에 담으세요.",
            expect: ["b_visit_gap"],
            hint: "groupby('churn')['visits_per_week'].mean()",
            solution: String.raw`cv = df_b.groupby("churn")["visits_per_week"].mean()
b_visit_gap = float(cv.loc[0] - cv.loc[1])`,
          },
          {
            id: "b3",
            title: "성별 이탈률 차이",
            prompt: "성별 이탈률을 구해 남성(M) 이탈률에서 여성(F) 이탈률을 뺀 값을 `b_gender_gap`에 담으세요.",
            expect: ["b_gender_gap"],
            hint: "groupby('gender')['churn'].mean()",
            solution: String.raw`gr = df_b.groupby("gender")["churn"].mean()
b_gender_gap = float(gr.loc["M"] - gr.loc["F"])`,
          },
          {
            id: "b4",
            title: "연령대별 이탈률",
            prompt: "`pd.cut(df_b['age'], bins=[17, 29, 39, 49, 64], labels=['18-29', '30대', '40대', '50-64'])`로 연령대 컬럼을 만들고, 연령대별 이탈률이 가장 높은 구간 이름을 `b_worst_age`에, 그 이탈률을 `b_worst_age_rate`에 담으세요.",
            expect: ["b_worst_age", "b_worst_age_rate"],
            hint: "groupby(연령대, observed=False)['churn'].mean() 후 idxmax()를 str()로",
            solution: String.raw`df_b["age_band"] = pd.cut(df_b["age"], bins=[17, 29, 39, 49, 64],
                          labels=["18-29", "30대", "40대", "50-64"])
band_rate = df_b.groupby("age_band", observed=False)["churn"].mean()
b_worst_age = str(band_rate.idxmax())
b_worst_age_rate = float(band_rate.max())`,
          },
        ],
      },
      {
        title: "중문제 3 · 이탈 예측 모델링",
        cond: "조건: `weight_change < 0` (체중이 줄어든 회원)만. 가변수를 만들어 이탈을 예측합니다.",
        steps: [
          {
            id: "c1",
            title: "필터와 평균 감량",
            prompt: "감량 회원만 담은 `df_c`를 만들어 행 수를 `c_rows`에, 평균 체중변화(음수)를 `c_mean_loss`에 담으세요.",
            expect: ["c_rows", "c_mean_loss"],
            hint: "df[df['weight_change'] < 0].copy()",
            solution: String.raw`df_c = df[df["weight_change"] < 0].copy()
c_rows = len(df_c)
c_mean_loss = float(df_c["weight_change"].mean())`,
          },
          {
            id: "c2",
            title: "방문-감량 상관",
            prompt: "감량 회원에서 `visits_per_week`와 `weight_change`의 상관계수를 `c_corr`에 담으세요.",
            expect: ["c_corr"],
            hint: "Series.corr — 많이 올수록 더 빠지면 음수",
            solution: String.raw`c_corr = float(df_c["visits_per_week"].corr(df_c["weight_change"]))`,
          },
          {
            id: "c3",
            title: "가변수 생성",
            prompt: "`df_c[['visits_per_week', 'pt_sessions', 'age', 'gender', 'plan']]`에 `pd.get_dummies(columns=['gender', 'plan'])`를 적용한 `df_g`를 만드세요. 더미 컬럼 수(`gender_`/`plan_`으로 시작)를 `c_dummy_cols`에, 전체 컬럼 수를 `c_ncols`에 담으세요.",
            expect: ["c_dummy_cols", "c_ncols"],
            hint: "성별 2종 + 이용권 3종 → 더미 5개",
            solution: String.raw`df_g = pd.get_dummies(df_c[["visits_per_week", "pt_sessions", "age", "gender", "plan"]],
                      columns=["gender", "plan"])
c_dummy_cols = sum(1 for c in df_g.columns if c.startswith("gender_") or c.startswith("plan_"))
c_ncols = int(df_g.shape[1])`,
          },
          {
            id: "c4",
            title: "로지스틱 회귀",
            prompt: "`X = df_g`, `y = df_c['churn']`을 `train_test_split(test_size=0.3, random_state=42, stratify=y)`로 나누고 `LogisticRegression(max_iter=1000)`의 테스트 정확도를 `c_acc`에, 재현율을 `c_rec`에 담으세요.",
            expect: ["c_acc", "c_rec"],
            hint: "accuracy_score, recall_score",
            solution: String.raw`from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, recall_score
X_g = df_g
y_g = df_c["churn"]
Xg_tr, Xg_te, yg_tr, yg_te = train_test_split(X_g, y_g, test_size=0.3, random_state=42, stratify=y_g)
logit_g = LogisticRegression(max_iter=1000).fit(Xg_tr, yg_tr)
pred_g = logit_g.predict(Xg_te)
c_acc = float(accuracy_score(yg_te, pred_g))
c_rec = float(recall_score(yg_te, pred_g))`,
          },
          {
            id: "c5",
            title: "회원 군집화",
            prompt: "`df_c[['visits_per_week', 'pt_sessions', 'weight_change']]`를 `StandardScaler`로 표준화하고 `KMeans(n_clusters=3, random_state=42, n_init=10)`으로 군집화해 실루엣 계수를 `c_sil`에 담으세요.",
            expect: ["c_sil"],
            hint: "silhouette_score(X_scaled, labels)",
            solution: String.raw`from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
Xk = StandardScaler().fit_transform(df_c[["visits_per_week", "pt_sessions", "weight_change"]])
km_g = KMeans(n_clusters=3, random_state=42, n_init=10).fit(Xk)
c_sil = float(silhouette_score(Xk, km_g.labels_))`,
          },
        ],
      },
    ],
  },
];

// 대문제(sections)는 단계를 평탄화해 기존 런타임(steps 기반)과 호환시킨다.
// 각 단계에 소속 중문제 제목을 남겨 풀이 화면에서 구역을 표시한다.
for (const p of window.DS_PROBLEMS) {
  if (p.sections) {
    for (const sec of p.sections) {
      for (const st of sec.steps) st.section = sec.title;
    }
    p.steps = p.sections.flatMap((sec) => sec.steps);
  }
}
