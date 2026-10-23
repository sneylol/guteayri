<?php
// Builds the GuteAyri test course: one quiz with every question type and a student to take it.
// Needs Moodle 5.1 with qtype_coderunner, gapfill, wordselect, crossword, stack, formulas, kprime, mtf and matrix.
// STACK also needs a Maxima server and CodeRunner a Jobe server. Copy this folder into the Moodle root as gtest/,
// then run `php gtest/images.php`, `python3 gtest/build_xml.py` and `php gtest/setup.php`, in that order.
define('CLI_SCRIPT', true);
require(__DIR__ . '/../config.php');
require_once($CFG->libdir . '/testing/generator/lib.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/mod/quiz/locallib.php');
require_once($CFG->dirroot . '/question/format.php');
require_once($CFG->dirroot . '/question/format/xml/format.php');
require_once($CFG->dirroot . '/user/lib.php');

// Question test generators load Moodle's PHPUnit helpers, which extend PHPUnit classes that a
// production Moodle doesn't ship. Empty stand-ins are enough: no test code runs.
eval('namespace PHPUnit\\Framework { abstract class TestCase {} class Assert {} }
      namespace PHPUnit\\Framework\\Constraint { abstract class Constraint {} }');

\core\session\manager::set_user(get_admin());
$gen = new testing_data_generator();

// Start from a clean course each run.
if ($old = $DB->get_record('course', ['shortname' => 'GTEST'])) {
    delete_course($old, false);
}
$course = create_course((object) ['fullname' => 'GuteAyri test course', 'shortname' => 'GTEST', 'category' => 1]);

$quiz = $gen->create_module('quiz', [
    'course' => $course->id,
    'name' => 'Every question type',
    'intro' => 'One question of each type Moodle and the common plugins offer.',
    'questionsperpage' => 0,
    'preferredbehaviour' => 'deferredfeedback',
    'grade' => 100,
    'navmethod' => 'free',
    'attempts' => 0,
]);
$cm = get_coursemodule_from_instance('quiz', $quiz->id);
$context = context_module::instance($cm->id);
$default = question_get_default_category($context->id, true);

// Import the XML questions into this quiz's own question bank.
$format = new qformat_xml();
$format->setCategory($default);
$format->setContexts([$context]);
$format->setCourse($course);
$format->setFilename(__DIR__ . '/questions.xml');
$format->setRealfilename('questions.xml');
$format->setMatchgrades('nearest');
$format->setCatfromfile(true);
$format->setContextfromfile(false);
$format->setStoponerror(true);
$ok = $format->importpreprocess() && $format->importprocess() && $format->importpostprocess();
if (!$ok) {
    throw new moodle_exception('Import failed');
}
echo "Imported XML questions\n";

// STACK questions come from STACK's own test generator: one per input type.
$qgen = $gen->get_plugin_generator('core_question');
$maincat = $DB->get_record('question_categories', ['contextid' => $context->id, 'name' => 'GuteAyri test'], '*', MUST_EXIST);
$stack = [
    'algebraic_input' => 'algebraic', 'numerical_input' => 'numerical', 'units_input' => 'units', 'matrix_input' => 'matrix',
    'dropdown_input' => 'dropdown', 'radio_input' => 'radio', 'checkbox_input' => 'checkbox', 'true_false_input' => 'true/false',
    'string_input' => 'string', 'textarea_input' => 'textarea', 'equiv_input' => 'equivalence reasoning', 'single_char_input' => 'single character',
];
$n = 33;
foreach ($stack as $which => $label) {
    $qgen->create_question('stack', $which, ['category' => $maincat->id, 'name' => sprintf('%02d STACK, %s input', $n++, $label)]);
}
echo "Created STACK questions\n";

// Every question in the main category, in name order, plus the random short-answer matching from its subcategory.
$sql = "SELECT q.id, q.name, q.qtype
          FROM {question} q
          JOIN {question_versions} v ON v.questionid = q.id
          JOIN {question_bank_entries} e ON e.id = v.questionbankentryid
          JOIN {question_categories} c ON c.id = e.questioncategoryid
         WHERE c.contextid = ? AND q.parent = 0 AND (c.name = 'GuteAyri test' OR q.qtype = 'randomsamatch')
      ORDER BY q.name";
$questions = $DB->get_records_sql($sql, [$context->id]);
foreach ($questions as $q) {
    quiz_add_quiz_question($q->id, $quiz, 1);
    echo "  {$q->name} ({$q->qtype})\n";
}
\mod_quiz\quiz_settings::create($quiz->id)->get_grade_calculator()->recompute_quiz_sumgrades();

// A student to take the quiz.
$student = $DB->get_record('user', ['username' => 'student']);
if (!$student) {
    $student = $gen->create_user(['username' => 'student', 'password' => 'Student-test1', 'firstname' => 'Sam', 'lastname' => 'Student']);
}
$gen->enrol_user($student->id, $course->id, 'student');

echo "\nQuiz: {$CFG->wwwroot}/mod/quiz/view.php?id={$cm->id}\n";
echo "Log in as student / Student-test1\n";
