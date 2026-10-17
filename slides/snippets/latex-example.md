---
marp: true
theme: marpres
paginate: false
math: mathjax
---

<!-- _layout: cols 1 1 -->

# Equations stay in Markdown

:::: panel id=snippet-math-source-panel align=left valign=center
::: box id=snippet-math-description
## A simple model

A weighted combination of two inputs:

$y = w_1x_1 + w_2x_2 + b$

Keep the explanation beside the equation.
:::
::::

:::: panel id=snippet-math-equation-panel valign=center
::: box id=snippet-math-equation
$$
\mathbf y = X\mathbf w + \mathbf b
$$

$$
X = \begin{pmatrix}
1 & 2 \\
3 & 4
\end{pmatrix}
$$
:::
::::
