#!/usr/bin/env python3
"""Writes questions.xml: one question of every Moodle question type, each with one clear right answer.
STACK questions come from STACK's own test generator instead (see setup.php)."""
import base64, os
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
def b64(name):
    return base64.b64encode(open(os.path.join(HERE, name), "rb").read()).decode()

def cdata(s):
    return f"<![CDATA[{s}]]>"

def text(tag, s, fmt="html"):
    return f'<{tag} format="{fmt}"><text>{cdata(s)}</text></{tag}>'

def head(qtype, name, qtext, grade=1, files=""):
    return (f'<question type="{qtype}"><name><text>{escape(name)}</text></name>'
            f'<questiontext format="html"><text>{cdata(qtext)}</text>{files}</questiontext>'
            f'<generalfeedback format="html"><text></text></generalfeedback>'
            f'<defaultgrade>{grade}</defaultgrade><penalty>0.3333333</penalty><hidden>0</hidden><idnumber></idnumber>')

FB = text("correctfeedback", "") + text("partiallycorrectfeedback", "") + text("incorrectfeedback", "")

def answer(t, fraction, extra="", fmt="html"):
    return f'<answer fraction="{fraction}" format="{fmt}"><text>{cdata(t)}</text><feedback format="html"><text></text></feedback>{extra}</answer>'

def category(path):
    return f'<question type="category"><category><text>$module$/top/{path}</text></category></question>'

Q = []
def add(x):
    Q.append(x)

add(category("GuteAyri test"))

# ---- Core: choice questions ----
add(head("multichoice", "01 Multiple choice, one answer", "<p>What is the capital of Australia?</p>")
    + "<single>true</single><shuffleanswers>true</shuffleanswers><answernumbering>abc</answernumbering><showstandardinstruction>0</showstandardinstruction>" + FB
    + answer("Sydney", 0) + answer("Canberra", 100) + answer("Melbourne", 0) + answer("Perth", 0) + "</question>")

add(head("multichoice", "02 Multiple choice, several answers", "<p>Which of these numbers are prime?</p>")
    + "<single>false</single><shuffleanswers>true</shuffleanswers><answernumbering>abc</answernumbering><showstandardinstruction>1</showstandardinstruction>" + FB
    + answer("2", 33.33333) + answer("9", -100) + answer("11", 33.33333) + answer("15", -100) + answer("17", 33.33334) + "</question>")

add(head("truefalse", "03 True/False", "<p>At sea level, water boils at 100 °C.</p>")
    + answer("true", 100, fmt="moodle_auto_format") + answer("false", 0, fmt="moodle_auto_format") + "</question>")

# ---- Core: typed answers ----
add(head("shortanswer", "04 Short answer", "<p>What is the chemical symbol for gold?</p>")
    + "<usecase>0</usecase>" + answer("Au", 100, fmt="moodle_auto_format") + "</question>")

def unit(name, mult):
    return f"<unit><multiplier>{mult}</multiplier><unit_name>{name}</unit_name></unit>"

add(head("numerical", "05 Numerical, unit from a dropdown", "<p>A car travels 150 km in 3 hours. What is its average speed?</p>")
    + answer("50", 100, "<tolerance>0</tolerance>", fmt="moodle_auto_format")
    + "<units>" + unit("km/h", 1) + unit("m/s", 0.2777778) + unit("mph", 0.6213712) + "</units>"
    + "<unitgradingtype>1</unitgradingtype><unitpenalty>1</unitpenalty><showunits>2</showunits><unitsleft>0</unitsleft></question>")

add(head("numerical", "06 Numerical, unit from radio buttons", "<p>How many metres are in 2.5 kilometres? Give the number and pick the unit.</p>")
    + answer("2500", 100, "<tolerance>0</tolerance>", fmt="moodle_auto_format")
    + "<units>" + unit("m", 1) + unit("km", 0.001) + unit("cm", 100) + "</units>"
    + "<unitgradingtype>1</unitgradingtype><unitpenalty>1</unitpenalty><showunits>1</showunits><unitsleft>0</unitsleft></question>")

tri = '<p><img src="@@PLUGINFILE@@/triangle.png" alt="A right triangle" width="420" height="320"></p><p>How long is side c of this right triangle?</p>'
add(head("numerical", "07 Numerical with a picture", tri, files=f'<file name="triangle.png" path="/" encoding="base64">{b64("triangle.png")}</file>')
    + answer("5", 100, "<tolerance>0</tolerance>", fmt="moodle_auto_format")
    + "<unitgradingtype>0</unitgradingtype><unitpenalty>0.1</unitpenalty><showunits>3</showunits><unitsleft>0</unitsleft></question>")

def dataset(name, lo, hi, values, qtype):
    items = "".join(f"<dataset_item><number>{i + 1}</number><value>{v}</value></dataset_item>" for i, v in enumerate(values))
    status = "private"
    return (f"<dataset_definition><status><text>{status}</text></status><name><text>{name}</text></name><type>calculated</type>"
            f"<distribution><text>uniform</text></distribution><minimum><text>{lo}</text></minimum><maximum><text>{hi}</text></maximum>"
            f"<decimals><text>0</text></decimals><itemcount>{len(values)}</itemcount><dataset_items>{items}</dataset_items>"
            f"<number_of_items>{len(values)}</number_of_items></dataset_definition>")

CALC_ANSWER = "<tolerance>0.01</tolerance><tolerancetype>1</tolerancetype><correctanswerformat>1</correctanswerformat><correctanswerlength>2</correctanswerlength>"

add(head("calculated", "08 Calculated", "<p>What is {a} × {b}?</p>")
    + "<synchronize>0</synchronize><single>0</single><answernumbering>abc</answernumbering><shuffleanswers>0</shuffleanswers>" + FB
    + answer("{a}*{b}", 100, CALC_ANSWER, fmt="moodle_auto_format")
    + "<unitgradingtype>0</unitgradingtype><unitpenalty>0.1</unitpenalty><showunits>3</showunits><unitsleft>0</unitsleft>"
    + "<dataset_definitions>" + dataset("a", 2, 9, [3, 7, 4], "calculated") + dataset("b", 11, 19, [12, 15, 13], "calculated") + "</dataset_definitions></question>")

add(head("calculatedsimple", "09 Calculated simple", "<p>A rectangle is {w} cm wide and {h} cm tall. What is its area in cm²? Give the number only.</p>")
    + "<synchronize>0</synchronize><single>0</single><answernumbering>abc</answernumbering><shuffleanswers>0</shuffleanswers>" + FB
    + answer("{w}*{h}", 100, CALC_ANSWER, fmt="moodle_auto_format")
    + "<unitgradingtype>0</unitgradingtype><unitpenalty>0.1</unitpenalty><showunits>3</showunits><unitsleft>0</unitsleft>"
    + "<dataset_definitions>" + dataset("w", 3, 9, [6, 4, 8], "calculatedsimple") + dataset("h", 3, 9, [5, 7, 3], "calculatedsimple") + "</dataset_definitions></question>")

add(head("calculatedmulti", "10 Calculated multichoice", "<p>What is {a} + {b}?</p>")
    + "<synchronize>0</synchronize><single>1</single><answernumbering>abc</answernumbering><shuffleanswers>1</shuffleanswers>" + FB
    + answer("{={a}+{b}}", 100, CALC_ANSWER, fmt="moodle_auto_format")
    + answer("{={a}+{b}+10}", 0, CALC_ANSWER, fmt="moodle_auto_format")
    + answer("{={a}*{b}}", 0, CALC_ANSWER, fmt="moodle_auto_format")
    + "<unitgradingtype>0</unitgradingtype><unitpenalty>0.1</unitpenalty><showunits>3</showunits><unitsleft>0</unitsleft>"
    + "<dataset_definitions>" + dataset("a", 20, 40, [23, 31, 27], "calculatedmulti") + dataset("b", 50, 70, [58, 64, 61], "calculatedmulti") + "</dataset_definitions></question>")

# ---- Core: matching and gaps ----
def sub(stem, ans):
    return f'<subquestion format="html"><text>{cdata(stem)}</text><answer><text>{escape(ans)}</text></answer></subquestion>'

add(head("match", "11 Matching", "<p>Match each country with its capital.</p>")
    + "<shuffleanswers>true</shuffleanswers>" + FB
    + sub("France", "Paris") + sub("Germany", "Berlin") + sub("Italy", "Rome") + sub("Spain", "Madrid") + sub("", "Lisbon") + "</question>")

add(head("gapselect", "13 Select missing words", "<p>The largest planet in the Solar System is [[1]], and the planet closest to the Sun is [[2]].</p>")
    + "<shuffleanswers>1</shuffleanswers>" + FB
    + "".join(f"<selectoption><text>{w}</text><group>1</group></selectoption>" for w in ["Jupiter", "Mercury", "Mars", "Venus"]) + "</question>")

cloze = ("<p>{1:SHORTANSWER:=Paris} is the capital of France.</p>"
         "<p>7 × 8 = {1:NUMERICAL:=56:0}</p>"
         "<p>The Pacific is the {1:MULTICHOICE:smallest~=largest~coldest} ocean on Earth.</p>"
         "<p>Which animal is a mammal? {1:MULTICHOICE_V:shark~=dolphin~trout}</p>"
         "<p>Which colour do you get by mixing blue and yellow? {1:MULTICHOICE_H:red~=green~purple}</p>"
         "<p>Select every even number: {2:MULTIRESPONSE:%50%2~%50%4~%-100%5~%-100%7}</p>")
add(head("multianswer", "14 Embedded answers (Cloze)", cloze, grade=7) + "</question>")

# ---- Core: essays ----
def essay(name, q, fmt, attachments=0, lines=8):
    return (head("essay", name, q, grade=1) + f"<responseformat>{fmt}</responseformat><responserequired>1</responserequired>"
            f"<responsefieldlines>{lines}</responsefieldlines><minwordlimit></minwordlimit><maxwordlimit></maxwordlimit>"
            f"<attachments>{attachments}</attachments><attachmentsrequired>0</attachmentsrequired><maxbytes>0</maxbytes><filetypeslist></filetypeslist>"
            + text("graderinfo", "") + text("responsetemplate", "") + "</question>")

add(essay("15 Essay, rich-text editor with attachments", "<p>In one or two sentences, explain why the sky looks blue during the day.</p>", "editor", attachments=1))
add(essay("16 Essay, plain text", "<p>Name the three primary colours of light.</p>", "plain", lines=5))
add(essay("17 Essay, monospaced", "<p>Write an SQL query that selects every column of every row from the table <code>users</code>.</p>", "monospaced", lines=5))

# ---- Core: drag and drop ----
def dragbox(t, group, infinite=False):
    return f"<dragbox><text>{escape(t)}</text><group>{group}</group>{'<infinite/>' if infinite else ''}</dragbox>"

add(head("ddwtos", "18 Drag and drop into text", "<p>In the nursery rhyme, the [[1]] jumped over the [[2]]. A young cat is called a [[4]].</p>")
    + "<shuffleanswers>1</shuffleanswers>" + FB
    + dragbox("cow", 1) + dragbox("moon", 1) + dragbox("sun", 1) + dragbox("kitten", 2) + dragbox("puppy", 2) + dragbox("calf", 2) + "</question>")

def ddimage_drag(no, t, group=1):
    return f"<drag><no>{no}</no><text>{escape(t)}</text><draggroup>{group}</draggroup></drag>"

def ddimage_drop(no, choice, x, y):
    return f"<drop><text></text><no>{no}</no><choice>{choice}</choice><xleft>{x}</xleft><ytop>{y}</ytop></drop>"

add(head("ddimageortext", "19 Drag and drop onto image", "<p>Drag the name of each shape onto it.</p>")
    + "<shuffleanswers/>" + FB
    + f'<file name="shapes.png" path="/" encoding="base64">{b64("shapes.png")}</file>'
    + ddimage_drag(1, "Circle") + ddimage_drag(2, "Square") + ddimage_drag(3, "Triangle") + ddimage_drag(4, "Pentagon")
    + ddimage_drop(1, 1, 55, 105) + ddimage_drop(2, 2, 255, 100) + ddimage_drop(3, 3, 455, 140) + "</question>")

add(head("ddmarker", "20 Drag markers", "<p>Place <b>Centre</b> on the centre of the blue circle (marked with a dot), and <b>Corner</b> on the top-left corner of the green square.</p>")
    + "<shuffleanswers/><showmisplaced/>" + FB
    + f'<file name="targets.png" path="/" encoding="base64">{b64("targets.png")}</file>'
    + "<drag><no>1</no><text>Centre</text><noofdrags>1</noofdrags></drag><drag><no>2</no><text>Corner</text><noofdrags>1</noofdrags></drag>"
    + "<drop><no>1</no><shape>circle</shape><coords>150,200;25</coords><choice>1</choice></drop>"
    + "<drop><no>2</no><shape>circle</shape><coords>380,120;25</coords><choice>2</choice></drop></question>")

add(head("ordering", "21 Ordering", "<p>Put these planets in order of distance from the Sun, closest first.</p>")
    + "<layouttype>VERTICAL</layouttype><selecttype>ALL</selecttype><selectcount>0</selectcount><gradingtype>ABSOLUTE_POSITION</gradingtype>"
    + "<showgrading>SHOW</showgrading><numberingstyle>none</numberingstyle>" + FB
    + "".join(answer(p, i + 1, fmt="moodle_auto_format") for i, p in enumerate(["Mercury", "Venus", "Earth", "Mars", "Jupiter"]))
    # Moodle 5.1's ordering import fails unless the question has at least two hints.
    + '<hint format="html"><text>Mercury is closest.</text><shownumcorrect/><options>1</options></hint>'
    + '<hint format="html"><text>Jupiter is farthest.</text><shownumcorrect/><options>1</options></hint></question>')

add(head("description", "22 Description", "<p><b>The next questions use question-type plugins.</b> This text has no answer.</p>", grade=0) + "</question>")

# ---- Plugins ----
add(head("coderunner", "23 CodeRunner (Python)", "<p>Write a Python function <code>add(a, b)</code> that returns the sum of its two arguments.</p>")
    + "<coderunnertype>python3</coderunnertype><prototypetype>0</prototypetype><allornothing>1</allornothing><penaltyregime>0, 10, 20, ...</penaltyregime>"
    + "<precheck>0</precheck><showsource>0</showsource><answerboxlines>8</answerboxlines><answerboxcolumns>70</answerboxcolumns><answerpreload></answerpreload>"
    + "<useace>1</useace><resultcolumns></resultcolumns><template></template><iscombinatortemplate></iscombinatortemplate>"
    + "<answer>def add(a, b):\n    return a + b\n</answer><validateonsave>1</validateonsave><testsplitterre></testsplitterre><language></language><acelang></acelang>"
    + "<sandbox></sandbox><grader></grader><cputimelimitsecs></cputimelimitsecs><memlimitmb></memlimitmb><sandboxparams></sandboxparams><templateparams></templateparams>"
    + "<testcases>"
    + "".join(f'<testcase testtype="0" useasexample="{1 if i == 0 else 0}" hiderestiffail="0" mark="1.0000000"><testcode><text>{escape(c)}</text></testcode>'
              f"<stdin><text></text></stdin><expected><text>{e}</text></expected><extra><text></text></extra><display><text>SHOW</text></display></testcase>"
              for i, (c, e) in enumerate([("print(add(2, 3))", "5"), ("print(add(-4, 10))", "6"), ("print(add(0.5, 0.25))", "0.75")]))
    + "</testcases></question>")

def gapfill(name, q, display, distractors):
    gaps = [g for g in __import__("re").findall(r"\[([^\]]+)\]", q)]
    return (head("gapfill", name, q) + f"<answerdisplay>{display}</answerdisplay><delimitchars>[]</delimitchars><casesensitive>0</casesensitive>"
            "<noduplicates>0</noduplicates><disableregex>0</disableregex><fixedgapsize>0</fixedgapsize><optionsaftertext>0</optionsaftertext>"
            "<letterhints>0</letterhints><singleuse>0</singleuse>"
            + "".join(answer(g, 100, fmt="moodle_auto_format") for g in gaps)
            + "".join(answer(d, 0, fmt="moodle_auto_format") for d in distractors) + FB + "</question>")

add(gapfill("24 Gapfill, drag and drop", "<p>The capital of Japan is [Tokyo] and the capital of Egypt is [Cairo].</p>", "dragdrop", ["Osaka", "Giza"]))
add(gapfill("25 Gapfill, typed gaps", "<p>Two plus two is [four], and the opposite of up is [down].</p>", "gapfill", []))
add(gapfill("26 Gapfill, dropdowns", "<p>Ice is frozen [water], and the Sun is a [star].</p>", "dropdown", ["planet", "sand"]))

add(head("wordselect", "27 Word select", "<p>Select every verb in this sentence: The cat [runs] across the garden and [jumps] over the fence.</p>")
    + "<introduction>Select the verbs.</introduction><delimitchars>[]</delimitchars><wordpenalty>1</wordpenalty>"
    + answer("runs", 100, fmt="moodle_auto_format") + answer("jumps", 100, fmt="moodle_auto_format") + FB + "</question>")

def word(ans, clue, orient, r, c):
    return f'<word><answer>{ans}</answer><clue format="html"><text>{escape(clue)}</text></clue><orientation>{orient}</orientation><startrow>{r}</startrow><startcolumn>{c}</startcolumn></word>'

add(head("crossword", "28 Crossword", "<p>Solve the crossword.</p>", grade=3)
    + "<numrows>3</numrows><numcolumns>6</numcolumns><accentgradingtype>penalty</accentgradingtype><accentpenalty>0.2</accentpenalty><quotematching>0</quotematching>"
    + word("ROME", "Capital of Italy", 0, 0, 0) + word("ONE", "The number after zero", 1, 0, 1) + word("EARTH", "The planet we live on", 0, 2, 1) + FB + "</question>")

formulas = ("<p>A rectangle is 3 m long and 4 m wide. What is its area? Enter the number and the unit.</p>")
add(head("formulas", "29 Formulas, number and unit", formulas, grade=1) + FB
    + "<varsrandom><text></text></varsrandom><varsglobal><text></text></varsglobal><answernumbering><text>none</text></answernumbering>"
    + "<answers><partindex><text>0</text></partindex><placeholder><text></text></placeholder><answermark><text>1</text></answermark>"
    + "<answertype><text>0</text></answertype><numbox><text>1</text></numbox><vars1><text></text></vars1><answer><text>12</text></answer>"
    + "<answernotunique><text>1</text></answernotunique><vars2><text></text></vars2><correctness><text>_relerr &lt; 0.01</text></correctness>"
    + "<unitpenalty><text>1</text></unitpenalty><postunit><text>m^2</text></postunit><ruleid><text>1</text></ruleid><otherrule><text></text></otherrule>"
    + text("subqtext", "<p>Area = {_0} {_u}</p>") + text("feedback", "") + text("correctfeedback", "") + text("partiallycorrectfeedback", "") + text("incorrectfeedback", "")
    + "</answers></question>")

def tf_grid(qtype, name, q, rows, extra):
    out = head(qtype, name, q) + "<scoringmethod><text>subpoints</text></scoringmethod><shuffleanswers>false</shuffleanswers>"
    out += f"<numberofrows>{len(rows)}</numberofrows><numberofcolumns>2</numberofcolumns>{extra}"
    for i, (t, _) in enumerate(rows, 1):
        out += f'<row number="{i}"><optiontext format="html"><text>{cdata(t)}</text></optiontext><feedbacktext format="html"><text></text></feedbacktext></row>'
    out += '<column number="1"><responsetext format="moodle_auto_format"><text>True</text></responsetext></column>'
    out += '<column number="2"><responsetext format="moodle_auto_format"><text>False</text></responsetext></column>'
    for i, (_, truth) in enumerate(rows, 1):
        out += f'<weight rownumber="{i}" columnnumber="1"><value>{1 if truth else 0}.000</value></weight>'
        out += f'<weight rownumber="{i}" columnnumber="2"><value>{0 if truth else 1}.000</value></weight>'
    return out + FB + "</question>"

add(tf_grid("kprime", "30 Kprime", "<p>Decide whether each statement is true or false.</p>",
            [("Paris is in France.", True), ("2 + 2 = 5", False), ("The Earth orbits the Sun.", True), ("Ice is hotter than steam.", False)], ""))
add(tf_grid("mtf", "31 Multiple true/false", "<p>Decide whether each statement is true or false.</p>",
            [("A spider has eight legs.", True), ("The Moon is a planet.", False), ("Sound travels faster than light.", False)], "<answernumbering>123</answernumbering>"))

def matrix_row(t):
    return f"<row><shorttext>{escape(t)}</shorttext><description format=\"html\"><text></text></description><feedback format=\"html\"><text></text></feedback></row>"
def matrix_col(t):
    return f"<col><shorttext>{escape(t)}</shorttext><description format=\"html\"><text></text></description></col>"
rows = [("Dog", 0), ("Eagle", 1), ("Salmon", 2)]
add(head("matrix", "32 Matrix", "<p>Which group does each animal belong to?</p>") + "<use_dnd_ui>0</use_dnd_ui>"
    + "".join(matrix_row(r) for r, _ in rows) + "".join(matrix_col(c) for c in ["Mammal", "Bird", "Fish"])
    + "".join("<weights-of-row>" + "".join(f"<weight-of-col>{1 if j == k else 0}</weight-of-col>" for j in range(3)) + "</weights-of-row>" for _, k in rows)
    + "<grademethod>all</grademethod><shuffleanswers>0</shuffleanswers><multiple>0</multiple><renderer>matrix</renderer></question>")

# randomsamatch draws its pairs from the short-answer questions in its own category.
add(category("GuteAyri test/Elements"))
for name, sym in [("gold", "Au"), ("silver", "Ag"), ("iron", "Fe")]:
    add(head("shortanswer", f"Element {name}", f"<p>Chemical symbol for {name}</p>") + "<usecase>0</usecase>" + answer(sym, 100, fmt="moodle_auto_format") + "</question>")
add(head("randomsamatch", "12 Random short-answer matching", "<p>Match each element with its chemical symbol.</p>") + "<choose>3</choose><subcats>0</subcats>" + FB + "</question>")

open(os.path.join(HERE, "questions.xml"), "w").write('<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n' + "\n".join(Q) + "\n</quiz>\n")
print(len([q for q in Q if 'type="category"' not in q]), "questions")
