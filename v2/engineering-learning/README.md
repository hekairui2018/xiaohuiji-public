# 工程判断学徒流程

目标和评价见 [任务规范](../../docs/v2/工程判断长期学习任务.md)。独立本地采集工具，不改变当前客服回答、检索排序或模型权重。仅调用已经运行的本机 Bonsai 服务，不启动或重启服务。真实记录只写项目忽略的 tmp/engineering-learning，不公开。

在项目根目录运行（input 为私有 UTF-8 文本文件）：

```text
python v2/engineering-learning/session.py prepare case001 --input tmp/customer.txt --split train-candidate
python v2/engineering-learning/session.py model case001
python v2/engineering-learning/session.py engineer case001 --input tmp/engineer.txt
python v2/engineering-learning/session.py feedback case001 --turn 1 --input tmp/feedback.txt
python v2/engineering-learning/session.py model case001 --turn 1
python v2/engineering-learning/session.py comparison case001 --input tmp/comparison.txt
python v2/engineering-learning/test_session.py
```

先冻结模型首次输出，再独立询问工程师。工程师不看模型后修改答案；采集人不得把模型内容当提问前提。反馈只填写当时实际获得的客户观察或检索证据，不填写工程师期望的答案。后续轮次仅包含客户原话、此前模型输出和明确反馈；工程师笔记/差异记录不进入模型上下文。已有回执不能重跑覆盖；失败、截断均保留，不计有效判断，用新案例ID重试并在比较中标明关联。

本工具保存文本与原始请求/响应，不会自动确认诊断正确性、判定资料适用性、提升经验等级、生成训练集、调用检索工具或执行对调。检索由采集人通过现有只读工具完成，按任务规范记录，再作为反馈录入。人工逐项审查后才形成训练候选；validation/holdout 不能转入训练。有疑问或缺标注输出未评，不伪造分数。正式改权重前另行制定可回退训练实验，当前交付仅建立采集闭环。
