# Учёт расходов — сгенерировано Nodus

running = True
amount = 0
total = 0
count = 0
biggest = 0
report = ""


def on_start():
    global running, amount, total, count, biggest, report
    print("Учёт расходов. Пустая строка — закончить ввод.")
    while running:
        answer = input("Сумма: ")
        if len(answer) == 0:
            running = False
        else:
            amount = float(answer)
            answer_2 = input("На что: ")
            total = total + amount
            count = count + 1
            if amount > biggest:
                biggest = amount
            report = report + "{0:>10.2f}  {1}\n".format(amount, answer_2)
    if count > 0:
        print("\nЗаписей: {0}\nВсего потрачено: {1:.2f}\nСредняя трата: {2:.2f}\nСамая крупная: {3:.2f}".format(count, total, total / count, biggest))
        with open("расходы.txt", "w", encoding="utf-8") as _file:
            _file.write(str(report + "\nЗаписей: {0}\nВсего потрачено: {1:.2f}\nСредняя трата: {2:.2f}\nСамая крупная: {3:.2f}".format(count, total, total / count, biggest)))
        print("Отчёт сохранён в файл расходы.txt")
    else:
        print("Ничего не записано.")


if __name__ == "__main__":
    on_start()
